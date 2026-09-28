import type { Context, Hono } from "hono";

import type { AppEnv } from "../app-env";
import type { Auth } from "./auth";

// 浏览器发出的请求总是带着 Sec-Fetch-* 头（Fetch 规范要求，页面脚本改不掉），也会带上这个源上的
// Cookie（如果有）。真正的非浏览器 Bearer 调用（App）两者都没有：只有这种请求才算"genuine"。
function isGenuineBearerRequest(c: Context<AppEnv>): boolean {
  const hasSecFetchHeader = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"].some(
    (name) => c.req.header(name) !== undefined
  );
  return Boolean(c.req.header("authorization")) && !c.req.header("cookie") && !hasSecFetchHeader;
}

// spec 第 8.1 节第 8 步。它前面的中间件都不能读请求体：c.req.raw 的请求体只能读一次。
export function mountAuth(app: Hono<AppEnv>, auth: Auth): void {
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const res = await auth.handler(c.req.raw);
    // bearer 插件会把会话令牌放进 set-auth-token 响应头，页面脚本读得到，等于绕过了 HttpOnly。
    // 页面脚本自己加一个 Authorization 头冒充"App 请求"也拿不到：只有真正的非浏览器 Bearer 调用
    // 才留着这个头。
    if (!isGenuineBearerRequest(c)) {
      res.headers.delete("set-auth-token");
      res.headers.delete("access-control-expose-headers");
    }
    return res;
  });
}
