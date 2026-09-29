// account-rules.ts 的 before-hook 用它代替直接调 getSessionFromCtx。
//
// 为什么要自己转一遍 Bearer：Better Auth 的 before-hook 都拿同一个原始 context 跑
// （better-auth/dist/api/dispatch.mjs 的 runBeforeHooks），bearer 插件把 Bearer 令牌转成会话
// Cookie 的 { context: { headers } } 只在所有 before-hook 都跑完之后才合并进最终 context
// （dispatchAuthEndpoint 里，在 runBeforeHooks 返回之后）。同一批 before-hook 里的兄弟 hook（我们
// 的 accountRules）这时候读到的还是没转换过的原始 headers，getSessionFromCtx(ctx) 看不到 Bearer
// 会话，会把"已登录但用 Bearer"误判成"没登录"，从而放过重新登录和"至少留一种登录方式"的检查。
//
// 这里按 bearer 插件自己的转换方式（better-auth/dist/plugins/bearer/index.mjs）单独转一遍：把
// Authorization 头里签过名的令牌塞进一个新 Headers 的 Cookie 里，再正常查一次会话（同一套签名
// 校验、同一张 session 表，不用自己重新实现 HMAC 校验）。
//
// Bearer 优先，和 bearer 插件、sessionContext 一样：请求同时带着 Cookie 和 Bearer 令牌时，bearer 插件
// 用令牌盖掉 Cookie 里的会话，端点实际用的是 Bearer 的会话，检查的也必须是它。
//
// 端点依赖这个钩子缓存在 ctx.context.session 里的会话（getSessionFromCtx 查到后存在那里，端点的会话
// 中间件直接复用）。别拿它去配 sensitiveSessionMiddleware 之类重新取会话的用法：那样检查的和端点
// 实际用的可能不是同一个会话。
import { APIError, type createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setRequestCookie } from "better-auth/cookies/utils";

export type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// 和 bearer 插件一样按不区分大小写的 "bearer " 前缀认。
const BEARER_SCHEME = "bearer ";

function isBearerScheme(authHeader: string): boolean {
  return authHeader.slice(0, BEARER_SCHEME.length).toLowerCase() === BEARER_SCHEME;
}

// 和 bearer 插件一样只解 URL 编码；不接收没有签名的裸令牌（没有"."）——我们线上和测试的 bearer
// 插件都开着 requireSignature，裸令牌本来就不算登录，这里跟它保持一致。
function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractBearerToken(authHeader: string): string | null {
  if (!isBearerScheme(authHeader)) {
    return null;
  }
  const token = authHeader.slice(BEARER_SCHEME.length).trim();
  if (!token?.includes(".")) {
    return null;
  }
  return token.includes("%") ? tryDecode(token) : token;
}

// 把 Bearer 令牌接到一份新 Headers 的 Cookie 上，再交给 getSessionFromCtx 走正常的会话查询。
async function resolveBearerSession(ctx: HookContext, authHeader: string) {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return null;
  }
  const headers = new Headers(ctx.request?.headers ?? ctx.headers);
  setRequestCookie(headers, ctx.context.authCookies.sessionToken.name, token);
  return getSessionFromCtx({ ...ctx, headers });
}

// 带了 Bearer 就只认 Bearer 的会话：解不出会话（格式不对、签名不对、令牌查不到会话）就直接拒绝，不能
// 当成"没登录"放过后面的敏感操作检查——不然一个假的或者过期失效的 Bearer 头反而比不带任何认证信息更容易
// 绕过检查。别的认证方式（比如站点前面挂的 HTTP Basic）不是我们的登录信息，和没带一样按 Cookie 会话处理；
// 也没有 Cookie 会话时返回 null：交给端点自己的会话中间件返回 401。
export async function sessionForHook(ctx: HookContext) {
  const authHeader = ctx.request?.headers.get("authorization") ?? ctx.headers?.get("authorization");
  if (authHeader && isBearerScheme(authHeader)) {
    const bearerSession = await resolveBearerSession(ctx, authHeader);
    if (!bearerSession) {
      throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Sign in required" });
    }
    return bearerSession;
  }
  return getSessionFromCtx(ctx);
}
