import type { Hono } from "hono";

import type { AppEnv } from "../app-env";
import type { Auth } from "./auth";

// spec 第 8.1 节第 8 步。它前面的中间件都不能读请求体：c.req.raw 的请求体只能读一次。
export function mountAuth(app: Hono<AppEnv>, auth: Auth): void {
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const res = await auth.handler(c.req.raw);
    // bearer 插件会把会话令牌放进 set-auth-token 响应头，页面脚本读得到，等于绕过了 HttpOnly。
    // 网页请求（没带 Authorization）一律去掉；只有 App 用 Bearer 时才需要它。
    if (!c.req.header("authorization")) {
      res.headers.delete("set-auth-token");
      res.headers.delete("access-control-expose-headers");
    }
    return res;
  });
}
