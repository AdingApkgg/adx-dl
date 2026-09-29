import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

import { apiRoutes } from "./api/v1";
import type { AppEnv } from "./app-env";
import type { Auth } from "./auth/auth";
import { mountAuth, sessionContext } from "./auth/mount";
import { jsonError } from "./errors";
import { clientIp, rateLimitKeyForIp } from "./middleware/client-ip";
import { csrfGuard } from "./middleware/csrf";
import { rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { requestLog } from "./middleware/request-log";
import { securityHeaders } from "./middleware/security-headers";
import type { ApiServices } from "./services/api-services";
import { withTimeout } from "./with-timeout";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type HealthCheck = () => Promise<void>;

export type AppDeps = {
  log: Logger;
  isProduction: boolean;
  checks: Record<string, HealthCheck>;
  rateLimitStore: RateLimitStore;
  /** 浏览器看到的站点地址，CSRF 校验拿它和 Origin 头比较。 */
  publicOrigin: string;
  /** Better Auth 实例（createAuth 的返回值）。 */
  auth: Auth;
  /** /api/v1 的接口用到的依赖。 */
  services: ApiServices;
};

// 中间件顺序是 spec 第 8.1 节定的，改动前先对照 spec。
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.use("*", clientIp());
  app.use("*", requestLog(deps.log));
  app.use("*", securityHeaders({ isProduction: deps.isProduction }));

  // 服务端渲染时 loader 经进程内 API 调 /api/v1（in-process-api.ts）。会话满一天时续期发生在那次进程内
  // 的请求里，新的会话 Cookie 只在它的响应上，页面响应默认带不出去：浏览器的 Cookie 会停在登录后第 30 天
  // 过期，库里的会话却一直在续。getLoadContext 把这些 Set-Cookie 收进 inProcessSetCookies，这里补到页面
  // 响应上（文档请求和站内切换页面的 .data 请求都经过这里）。loader 会并发调几个接口，同名的只留最后一条。
  app.use("*", async (c, next) => {
    await next();
    const cookies = c.get("inProcessSetCookies");
    if (!cookies?.length) {
      return;
    }
    const byName = new Map<string, string>();
    for (const cookie of cookies) {
      byName.set(cookie.split("=", 1)[0], cookie);
    }
    for (const cookie of byName.values()) {
      c.res.headers.append("set-cookie", cookie);
    }
  });

  app.all("/media/*", (c) => jsonError(c, 404, "NOT_FOUND", "Not found"));

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    const results = await Promise.all(
      Object.entries(deps.checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), 2000);
          return [name, "ok"] as const;
        } catch (error) {
          deps.log.error("readiness_check_failed", { check: name, ...describeError(error) });
          return [name, "fail"] as const;
        }
      })
    );
    const ok = results.every(([, status]) => status === "ok");
    return c.json({ ok, checks: Object.fromEntries(results) }, ok ? 200 : 503);
  });

  // /api/v1/me 这类是每个用户自己的数据：接口的响应（包括限流的 429、出错的响应）一律不让浏览器和 Cloudflare
  // 缓存。接口自己设了 Cache-Control 的（比如 Better Auth 的 get-session）照它的。
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) {
      c.res.headers.set("Cache-Control", "private, no-store");
    }
  });

  app.use(
    "/api/*",
    rateLimit<AppEnv>({
      store: deps.rateLimitStore,
      name: "api-ip",
      limit: 300,
      windowSec: 60,
      key: (c) => rateLimitKeyForIp(c.get("clientIp")),
      onStoreError: (error) => deps.log.error("rate_limit_store_error", describeError(error)),
    })
  );

  // spec 第 10.2 节：登录相关的接口按 IP 每分钟 30 次（Cloudflare 边缘另有一条更宽的规则挡洪水）。
  app.use(
    "/api/auth/*",
    rateLimit<AppEnv>({
      store: deps.rateLimitStore,
      name: "auth-ip",
      limit: 30,
      windowSec: 60,
      key: (c) => rateLimitKeyForIp(c.get("clientIp")),
      onStoreError: (error) => deps.log.error("rate_limit_store_error", describeError(error)),
    })
  );

  // spec 第 8.1 节第 8 步。
  mountAuth(app, deps.auth);

  // spec 第 8.1 节第 9、10 步：先识别会话，再做 CSRF 校验。
  app.use("/api/v1/*", sessionContext(deps.auth));
  app.use("/api/v1/*", async (c, next) => {
    c.set("services", deps.services);
    await next();
  });
  app.use("/api/v1/*", csrfGuard({ publicOrigin: deps.publicOrigin }));
  // spec 第 10.2 节：改数据的接口按用户每分钟 60 次。读请求和未登录的请求不算。
  app.use(
    "/api/v1/*",
    rateLimit<AppEnv>({
      store: deps.rateLimitStore,
      name: "api-user-write",
      limit: 60,
      windowSec: 60,
      key: (c) => (READ_METHODS.has(c.req.method) ? null : (c.get("auth")?.user.id ?? null)),
      onStoreError: (error) => deps.log.error("rate_limit_store_error", describeError(error)),
    })
  );
  app.route("/", apiRoutes);

  // 必须是最后一个 /api 路由：没有它，未知接口会落到 React Router，拿到一个 HTML 404。
  app.all("/api/*", (c) => jsonError(c, 404, "NOT_FOUND", "Not found"));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return jsonError(c, error.status, codeForStatus(error.status), error.message || "Request failed");
    }
    deps.log.error("unhandled_error", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      ...describeError(error),
    });
    return jsonError(c, 500, "INTERNAL", "Internal server error");
  });

  return app;
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "INTERNAL";
    default:
      return `HTTP_${status}`;
  }
}
