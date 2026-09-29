import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "../app-env";
import type { Auth, AuthSession } from "./auth";

// /api/auth/* 的请求体上限。这里所有接口的请求都很小（登录、验证码、通行密钥的注册响应最多几 KB），
// 64 KiB 绰绰有余。这一条同时限住了通行密钥的凭据 id、公钥这些插件自己不检查长度的字段：
// 它们只能靠请求体的总大小来限。
const AUTH_BODY_LIMIT = 64 * 1024;

// 浏览器发出的请求总是带着 Sec-Fetch-* 头（Fetch 规范要求，页面脚本改不掉），也会带上这个源上的
// Cookie（如果有）。真正的非浏览器 Bearer 调用（App）两者都没有：只有这种请求才算"genuine"。
function isGenuineBearerRequest(c: Context<AppEnv>): boolean {
  const hasSecFetchHeader = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"].some(
    (name) => c.req.header(name) !== undefined
  );
  return Boolean(c.req.header("authorization")) && !c.req.header("cookie") && !hasSecFetchHeader;
}

// spec 第 8.1 节第 8 步。它前面的中间件都不能读请求体：c.req.raw 的请求体只能读一次。
// 下面的 bodyLimit 是例外：请求没带 Content-Length（分块传输）时，它要把请求体读进内存来数大小，
// 然后换一个装着这份内容的新 c.req.raw，后面的处理函数照常读得到。
export function mountAuth(app: Hono<AppEnv>, auth: Auth): void {
  app.use(
    "/api/auth/*",
    bodyLimit({
      maxSize: AUTH_BODY_LIMIT,
      // 响应体照 Better Auth 自己的错误格式：{ code, message }。
      onError: (c) => c.json({ code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" }, 413),
    })
  );
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

// spec 第 8.1 节第 9 步：网页读 Cookie，App 读 Authorization: Bearer，getSession 两种都认。
export function sessionContext(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { headers, response } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
    c.set("auth", response);
    await next();
    // 会话满一天会续期：数据库里的过期时间已经延长，新的 Set-Cookie 要带回浏览器。
    for (const cookie of headers.getSetCookie()) {
      c.res.headers.append("set-cookie", cookie);
    }
  };
}

/** 需要登录的接口里取当前会话；未登录时抛 401，由 app 的 onError 变成统一的错误格式。 */
export function currentAuth(c: Context<AppEnv>): AuthSession {
  const auth = c.get("auth");
  if (!auth) {
    throw new HTTPException(401, { message: "Sign in required" });
  }
  return auth;
}
