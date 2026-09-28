import { APIError, type BetterAuthPlugin, defineErrorCodes } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { account, passkey } from "../db/schema";
import { isRecentLogin } from "./recent-login";

export const ACCOUNT_ERROR_CODES = defineErrorCodes({
  REAUTH_REQUIRED: "Sign in again to continue",
  LAST_LOGIN_METHOD: "Keep at least one way to sign in",
});

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// 已登录才检查；没登录时交给端点自己的会话中间件返回 401。
async function requireRecentSession(ctx: HookContext) {
  const current = await getSessionFromCtx(ctx);
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
      ],
    },
    $ERROR_CODES: ACCOUNT_ERROR_CODES,
  } satisfies BetterAuthPlugin;
}
