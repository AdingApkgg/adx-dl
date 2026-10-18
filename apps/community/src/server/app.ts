import { createDeletionHandlers } from "./storage/deletion";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

import { createMediaDrain, type MediaDrain } from "./storage/drain";
import { createPublicMediaHandler, isMediaRequest } from "./storage/public-media";
import { mediaDenial } from "./storage/files";
import { isUploadPartRequest } from "./storage/parts";
import { StorageError } from "./storage/errors";
import { apiRoutes } from "./api/v1";
import type { AppEnv } from "./app-env";
import type { Auth } from "./auth/auth";
import { mountAuth, sessionContext } from "./auth/mount";
import { jsonError } from "./errors";
import { isInProcessRequest } from "./in-process-api";
import { bodyLimitWhenDeclared } from "./middleware/body-limit";
import { clientIp, rateLimitKeyForIp } from "./middleware/client-ip";
import { csrfGuard } from "./middleware/csrf";
import { pendingDeletionGuard } from "./middleware/pending-deletion";
import { rateLimit, uploadRateLimits, type RateLimitStore } from "./middleware/rate-limit";
import { requestLog } from "./middleware/request-log";
import { securityHeaders } from "./middleware/security-headers";
import { umamiProxy } from "./middleware/umami";
import type { ApiServices } from "./services/api-services";
import { throttledErrorLog } from "./throttled-log";
import { withTimeout } from "./with-timeout";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// spec 第 11.5 节。不收录的页面靠各自的 noindex，不在这里挡：挡了，爬虫就看不到 noindex，照样可能按外链收录地址。
// sitemap 等子项目 3、4 有了内容再加。
const ROBOTS_TXT = "User-agent: *\nDisallow: /api/\nDisallow: /_s/\n";

// /api/v1/* 的请求体上限，和 /api/auth/*（auth/mount.ts）一样是 64 KiB。现有的请求体都是很小的 JSON；
// 以后有接口要收更大的内容，要改这里：后面挂的中间件放不宽这里的上限。
const API_BODY_LIMIT = 64 * 1024;

export type HealthCheck = () => Promise<void>;

export type AppDeps = {
  log: Logger;
  isProduction: boolean;
  checks: Record<string, HealthCheck>;
  rateLimitStore: RateLimitStore;
  /** 浏览器看到的站点地址，CSRF 校验拿它和 Origin 头比较。 */
  publicOrigin: string;
  /** Umami 在容器网络里的地址，/_s/* 转发到这里；null 表示没开统计（没设 UMAMI_WEBSITE_ID）。 */
  umamiInternalUrl: string | null;
  /** Better Auth 实例（createAuth 的返回值）。 */
  auth: Auth;
  /** /api/v1 的接口用到的依赖（auth、log 由 createApp 从上面同名的两项放进去）。 */
  services: Omit<ApiServices, "auth" | "log">;
  /** Task11 also mounts this same instance on the internal-only listener. */
  mediaDrain?: MediaDrain;
};

// 中间件顺序是 spec 第 8.1 节定的，改动前先对照 spec。
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const storage = deps.services.storage;
  const secret = storage && "internalMediaSecret" in storage.config
    ? storage.config.internalMediaSecret : undefined;
  const drain = deps.mediaDrain ?? (storage && secret
    ? createMediaDrain({ db: storage.db, secret }) : undefined);
  const configuredStorage = storage && drain && secret ? {
    ...storage,
    onMediaPublished: async (hash: string, generation: number) => {
      const response = await drain.handle(new Request("http://internal/internal/media/resume", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ hash, generation }),
      }));
      if (!response.ok) throw new StorageError(503, "STORAGE_UNAVAILABLE");
    },
  } : storage;
  const services: ApiServices = {
    ...deps.services, dashChecks: deps.checks, storage: configuredStorage, auth: deps.auth, log: deps.log,
    deletionHandlers: configuredStorage ? createDeletionHandlers(configuredStorage, deps.services.deletionHandlers.filter(h => h.name !== "storage")) : deps.services.deletionHandlers,
  };
  // Redis 宕掉时每个请求都会在限流这一步出错：三条限流规则共用一个限了频的日志（1a 评审 R14）。
  const onRateLimitStoreError = throttledErrorLog(deps.log, "rate_limit_store_error");

  app.use("*", requestId());
  app.use("*", clientIp());
  app.use("*", requestLog(deps.log));
  // Cover dashboard documents, single-fetch data and API denials before auth can redirect or reject.
  app.use("*", async (c, next) => {
    const privateDash = /^\/(?:(?:zh|en|ja)\/)?dash(?:\/|\.data$|$)/.test(c.req.path)
      || /^\/api\/v1\/dash(?:\/|$)/.test(c.req.path)
      || /^\/(?:(?:zh|en|ja)\/)?me\/(?:favorites|reports)(?:\/|\.data$|$)/.test(c.req.path)
      || /^\/api\/v1\/me\/(?:favorites|reports)(?:\/|$)/.test(c.req.path);
    await next();
    if (privateDash) {
      c.res.headers.set("Cache-Control", "private, no-store");
      c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
  });
  app.use("/api/v1/me/charts/*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    await next();
    if (c.res.headers.get("accept-ranges") === "bytes")
      c.res.headers.set("content-security-policy", "default-src 'none'; sandbox");
  });
  app.use("/api/v1/charts*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    await next();
    if (c.res.headers.has("accept-ranges"))
      c.res.headers.set("content-security-policy", "default-src 'none'; sandbox");
  });
  const media = storage && drain ? createPublicMediaHandler(storage, drain) : undefined;
  app.use("*", async (c, next) => {
    // Node adapter exposes the exact request-target before URL dot-segment normalization.
    const rawTarget = (c.env as { incoming?: { url?: string } } | undefined)?.incoming?.url;
    if (!isMediaRequest(c.req.raw, rawTarget)) return next();
    const response = media ? await media(c.req.raw, rawTarget) : mediaDenial();
    response.headers.set("X-Request-Id", c.get("requestId"));
    return response;
  });

  // File streams retain their sandbox policy after the page security middleware completes.
  app.use("/api/v1/files/*", async (c, next) => {
    await next();
    if (c.res.headers.get("accept-ranges") === "bytes") {
      c.res.headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    }
  });
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

  // 页面上的跳转（未登录去登录页、待注销的去注销提示页、/zh 去掉前缀……）是 React Router 的 loader 和中间件抛出来的，
  // 不经过 entry.server.tsx 的 handleRequest，响应上没有 Cache-Control，还常带着上面补的续期 Cookie：
  // 一律不让浏览器和 Cloudflare 缓存。自己设了 Cache-Control 的跳转不动。
  app.use("*", async (c, next) => {
    await next();
    if (c.res.status >= 300 && c.res.status < 400 && !c.res.headers.has("cache-control")) {
      c.res.headers.set("Cache-Control", "private, no-store");
    }
  });


  // spec 第 8.1 节第 5 条：和 /media 一样挂在会话中间件之前。
  app.route(
    "/_s",
    umamiProxy({
      internalUrl: deps.umamiInternalUrl,
      onError: throttledErrorLog(deps.log, "umami_forward_failed"),
    })
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  // 只回答本机的探针（g510 上的 deploy.sh、容器的健康检查）：它列出依赖的名字和状态，不该对外（1a 评审遗留 #9）。
  // 经 Cloudflare 隧道来的请求一定带 CF-Connecting-IP（Cloudflare 自己加，访客去不掉），本机的探针不带。
  app.get("/readyz", async (c) => {
    if (c.req.header("cf-connecting-ip") !== undefined) {
      return jsonError(c, 404, "NOT_FOUND", "Not found");
    }
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

  app.get("/robots.txt", (c) => c.text(ROBOTS_TXT, 200, { "Cache-Control": "public, max-age=86400" }));

  // /api/v1/me 这类是每个用户自己的数据：接口的响应（包括限流的 429、出错的响应）一律不让浏览器和 Cloudflare
  // 缓存。接口自己设了 Cache-Control 的（比如 Better Auth 的 get-session）照它的。
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) {
      c.res.headers.set("Cache-Control", "private, no-store");
    }
  });

  // 服务端渲染时 loader 经进程内 API 发的请求不算：页面请求一次就要调好几个接口，按访客的 IP 计数的话，同一个 IP 后面的
  // 很多人（CGNAT、学校、公司）刷几下页面就会 429。页面请求本身由 Cloudflare 挡洪水。
  app.use(
    "/api/*",
    rateLimit<AppEnv>({
      store: deps.rateLimitStore,
      name: "api-ip",
      limit: 300,
      windowSec: 60,
      key: (c) => (isInProcessRequest(c) ? null : rateLimitKeyForIp(c.get("clientIp"))),
      onStoreError: onRateLimitStoreError,
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
      onStoreError: onRateLimitStoreError,
    })
  );

  // spec 第 8.1 节第 8 步。
  mountAuth(app, deps.auth);

  // spec 第 8.1 节第 9、10 步：先识别会话，再做 CSRF 校验。
  app.use("/api/v1/*", sessionContext(deps.auth));
  app.use("/api/v1/*", async (c, next) => {
    c.set("services", services);
    await next();
  });
  app.use("/api/v1/*", csrfGuard({ publicOrigin: deps.publicOrigin }));
  // JSON 校验器会先把整个请求体读进内存、解析完，才轮到各接口自己的规则，所以大小要在这里先限住。
  const jsonBodyLimit = bodyLimitWhenDeclared({
    maxSize: API_BODY_LIMIT,
    onError: (c) => jsonError(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large"),
  });
  app.use("/api/v1/*", async (c, next) => {
    // Exact parts read their bounded stream after authentication and concurrency admission.
    if (isUploadPartRequest(c.req.method, c.req.path)) return next();
    return jsonBodyLimit(c, next);
  });
  // spec 第 10.2 节：改数据的接口按用户每分钟 60 次。读请求和未登录的请求不算。
  app.use(
    "/api/v1/*",
    rateLimit<AppEnv>({
      store: deps.rateLimitStore,
      name: "api-user-write",
      limit: 60,
      windowSec: 60,
      key: (c) =>
        READ_METHODS.has(c.req.method) || isUploadPartRequest(c.req.method, c.req.path)
          ? null
          : (c.get("auth")?.user.id ?? null),
      onStoreError: onRateLimitStoreError,
    })
  );
  for (const middleware of uploadRateLimits({
    store: deps.rateLimitStore,
    onStoreError: onRateLimitStoreError,
  })) app.use("/api/v1/*", middleware);
  // spec 第 10.6 节：注销冷静期里除了几个接口，一律 403 ACCOUNT_PENDING_DELETION。
  app.use("/api/v1/*", pendingDeletionGuard());
  app.route("/", apiRoutes);

  // 必须是最后一个 /api 路由：没有它，未知接口会落到 React Router，拿到一个 HTML 404。
  app.all("/api/*", (c) => jsonError(c, 404, "NOT_FOUND", "Not found"));

  app.onError((error, c) => {
    if (error instanceof StorageError) {
      if (error.retryAfter) c.header("Retry-After", String(error.retryAfter));
      return jsonError(c, error.status as ContentfulStatusCode, error.code, error.message);
    }
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
