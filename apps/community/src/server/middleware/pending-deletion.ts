import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../app-env";
import { jsonError } from "../errors";

// 注销冷静期里还能用的接口（spec 第 10.6 节）：取当前用户（注销提示页要读状态和清除时间）、撤销注销，
// 以及不需要登录的公开接口。其余的对待注销的用户一律 403 ACCOUNT_PENDING_DELETION，前端据此整页跳到注销提示页
// （spec 第 11.4 节）。
const ALLOWED_WHILE_PENDING: readonly (readonly [method: string, path: RegExp])[] = [
  ["GET", /^\/api\/v1\/me$/],
  ["DELETE", /^\/api\/v1\/me\/deletion$/],
  ["GET", /^\/api\/v1\/meta$/],
  ["GET", /^\/api\/v1\/login-options$/],
  ["GET", /^\/api\/v1\/users\/[^/]+$/],
];

export function isAllowedWhilePending(method: string, path: string): boolean {
  // HEAD 和 GET 走同一个路由。
  const effective = method === "HEAD" ? "GET" : method;
  return ALLOWED_WHILE_PENDING.some(([allowed, pattern]) => allowed === effective && pattern.test(path));
}

// 挂在 /api/v1/* 上、会话识别之后。user.status 是 Better Auth 每次读会话时从 user 表现读的，撤销注销后下一个请求就放行。
export function pendingDeletionGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("auth")?.user.status === "pending_deletion" && !isAllowedWhilePending(c.req.method, c.req.path)) {
      return jsonError(c, 403, "ACCOUNT_PENDING_DELETION", "This account is scheduled for deletion");
    }
    await next();
  };
}
