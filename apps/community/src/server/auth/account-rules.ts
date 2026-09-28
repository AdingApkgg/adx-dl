import { APIError, type BetterAuthPlugin, defineErrorCodes } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { account, passkey } from "../db/schema";
import { type HookContext, sessionForHook } from "./hook-session";
import { isRecentLogin } from "./recent-login";

export const ACCOUNT_ERROR_CODES = defineErrorCodes({
  REAUTH_REQUIRED: "Sign in again to continue",
  LAST_LOGIN_METHOD: "Keep at least one way to sign in",
});

// 已登录才检查；没登录时交给端点自己的会话中间件返回 401。用 sessionForHook 而不是直接调
// getSessionFromCtx：before-hook 之间互相看不到彼此对 context 的改动，Bearer 令牌要在这里自己转
// 一遍才认得出来（见 hook-session.ts 顶部注释）。
async function requireRecentSession(ctx: HookContext) {
  const current = await sessionForHook(ctx);
  if (current && !isRecentLogin(current.session.createdAt)) {
    throw APIError.from("FORBIDDEN", ACCOUNT_ERROR_CODES.REAUTH_REQUIRED);
  }
  return current;
}

// 平台绑定加通行密钥。Better Auth 自己只数平台绑定，所以 allowUnlinkingAll 设成 true，由这里把关。
async function loginMethodCount(db: Db, userId: string): Promise<number> {
  const [accounts, passkeys] = await Promise.all([
    db.$count(account, eq(account.userId, userId)),
    db.$count(passkey, eq(passkey.userId, userId)),
  ]);
  return accounts + passkeys;
}

// Better Auth 和通行密钥插件没有的账号规则（spec 第 10.4 节），都挂在这个内部插件上。
export function accountRules(deps: { db: Db }) {
  return {
    id: "astrodx-account-rules",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/unlink-account",
          handler: createAuthMiddleware(async (ctx) => {
            const current = await requireRecentSession(ctx);
            if (current && (await loginMethodCount(deps.db, current.user.id)) <= 1) {
              throw APIError.from("BAD_REQUEST", ACCOUNT_ERROR_CODES.LAST_LOGIN_METHOD);
            }
          }),
        },
        {
          // 不要求重新登录的话，偷来的旧会话能绑一个攻击者自己的 Google，再用它正常登录一次，
          // 之后每次敏感操作的"会话 10 分钟内创建"检查都能用这个新会话轻松过关。
          matcher: (ctx) => ctx.path === "/link-social",
          handler: createAuthMiddleware(async (ctx) => {
            await requireRecentSession(ctx);
          }),
        },
      ],
    },
    $ERROR_CODES: ACCOUNT_ERROR_CODES,
  } satisfies BetterAuthPlugin;
}
