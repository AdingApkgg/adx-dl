import { APIError, type BetterAuthPlugin, defineErrorCodes } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { account, passkey } from "../db/schema";
import { UUID_PATTERN } from "../uuid";
import { type HookContext, sessionForHook } from "./hook-session";
import { isRecentLogin } from "./recent-login";

export const ACCOUNT_ERROR_CODES = defineErrorCodes({
  REAUTH_REQUIRED: "Sign in again to continue",
  LAST_LOGIN_METHOD: "Keep at least one way to sign in",
  SIGNUP_INVALID: "Invalid sign-up request",
  SIGNUP_CAPTCHA_FAILED: "Captcha verification failed",
  SIGNUP_CAPTCHA_UNAVAILABLE: "Captcha verification is temporarily unavailable",
  SIGNUP_SESSION_REQUIRED: "Passkey sign-up must create a session",
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

async function requireAnotherLoginMethod(db: Db, ctx: HookContext) {
  const current = await requireRecentSession(ctx);
  if (current && (await loginMethodCount(db, current.user.id)) <= 1) {
    throw APIError.from("BAD_REQUEST", ACCOUNT_ERROR_CODES.LAST_LOGIN_METHOD);
  }
}

// Better Auth 和通行密钥插件没有的账号规则（spec 第 10.4 节），都挂在这个内部插件上。
// 必须排在 passkey() 插件后面：它给 passkey 表加的字段要并进那个插件定义的表。
export function accountRules(deps: { db: Db }) {
  return {
    id: "astrodx-account-rules",
    schema: {
      // 插件自己没有"最后使用时间"，登录时由 passkeyPlugin 的 authentication.afterVerification 写入。
      passkey: { fields: { lastUsedAt: { type: "date", required: false, input: false } } },
    },
    hooks: {
      before: [
        {
          // 已登录时添加通行密钥也算敏感操作（本计划"与 spec 的偏离"第 4 条）。没登录时是在注册，不管。
          matcher: (ctx) => ctx.path === "/passkey/generate-register-options",
          handler: createAuthMiddleware(async (ctx) => {
            await requireRecentSession(ctx);
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/unlink-account",
          handler: createAuthMiddleware(async (ctx) => {
            await requireAnotherLoginMethod(deps.db, ctx);
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
        {
          matcher: (ctx) => ctx.path === "/passkey/delete-passkey" || ctx.path === "/passkey/update-passkey",
          handler: createAuthMiddleware(async (ctx) => {
            // 这两个接口拿客户端传来的 id 直接查 uuid 列（调研报告第 3 题）。
            const id = (ctx.body as { id?: unknown } | undefined)?.id;
            if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
              throw new APIError("NOT_FOUND", { code: "PASSKEY_NOT_FOUND", message: "Passkey not found" });
            }
            // 改名不算敏感操作；删除要刚登录过，并且不能删掉最后一种登录方式。
            if (ctx.path === "/passkey/delete-passkey") {
              await requireAnotherLoginMethod(deps.db, ctx);
            }
          }),
        },
      ],
      after: [
        {
          // 已登录添加时，插件把占位邮箱当成 WebAuthn 的用户名，它会显示在用户的系统密码管理器里
          // （真实 Chromium 实测）。换成昵称。
          matcher: (ctx) => ctx.path === "/passkey/generate-register-options",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as { user?: Record<string, unknown> } | undefined;
            const session = ctx.context.session;
            if (!session || !returned?.user) {
              return;
            }
            return ctx.json({
              ...returned,
              user: { ...returned.user, name: session.user.name, displayName: session.user.name },
            });
          }),
        },
      ],
    },
    $ERROR_CODES: ACCOUNT_ERROR_CODES,
  } satisfies BetterAuthPlugin;
}
