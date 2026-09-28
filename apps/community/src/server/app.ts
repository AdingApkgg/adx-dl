import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

import { apiRoutes } from "./api/v1";
import type { AppEnv } from "./app-env";
import { jsonError } from "./errors";
import { clientIp } from "./middleware/client-ip";
import { csrfGuard } from "./middleware/csrf";
import { rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { requestLog } from "./middleware/request-log";
import { securityHeaders } from "./middleware/security-headers";

export type HealthCheck = () => Promise<void>;

export type AppDeps = {
  log: Logger;
  isProduction: boolean;
  checks: Record<string, HealthCheck>;
  rateLimitStore: RateLimitStore;
  /** 浏览器看到的站点地址，CSRF 校验拿它和 Origin 头比较。 */
  publicOrigin: string;
};

// 中间件顺序是 spec 第 8.1 节定的，改动前先对照 spec。
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.use("*", clientIp());
  app.use("*", requestLog(deps.log));
  app.use("*", securityHeaders({ isProduction: deps.isProduction }));

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

  app.use(
    "/api/*",
    rateLimit<AppEnv>({
      store: deps.rateLimitStore,
      name: "api-ip",
      limit: 300,
      windowSec: 60,
      key: (c) => c.get("clientIp"),
      onStoreError: (error) =>
        deps.log.error("rate_limit_store_error", {
          message: error instanceof Error ? error.message : String(error),
        }),
    })
  );

  app.use("/api/v1/*", csrfGuard({ publicOrigin: deps.publicOrigin }));
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

async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
