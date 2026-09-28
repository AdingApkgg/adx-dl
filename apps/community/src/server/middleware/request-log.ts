import type { MiddlewareHandler } from "hono";

import type { Logger } from "@/shared/log";

import type { AppEnv } from "../app-env";

export function requestLog(log: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    // 只记路径不记查询串：以后查询串里可能出现令牌、验证码。
    log.info("request", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      ip: c.get("clientIp"),
    });
  };
}
