import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";

import type { AppEnv } from "./app-env";
import { jsonError } from "./errors";
import type { Logger } from "./log";
import { clientIp } from "./middleware/client-ip";
import { requestLog } from "./middleware/request-log";
import { securityHeaders } from "./middleware/security-headers";

export type AppDeps = {
  log: Logger;
  isProduction: boolean;
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
      message: error instanceof Error ? error.message : String(error),
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
    default:
      return `HTTP_${status}`;
  }
}
