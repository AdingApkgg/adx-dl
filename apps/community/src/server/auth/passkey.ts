import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { APIError } from "better-auth";
import { z } from "zod";

import { normalizeNickname } from "@/shared/nickname";

import { ACCOUNT_ERROR_CODES } from "./account-rules";
import { type TurnstileVerifier, turnstileRemoteIp } from "./turnstile";

/** 只用通行密钥注册时 resolveUser 返回的占位 id；真正的用户在 afterVerification 里建。 */
export const PASSKEY_SIGNUP = "__passkey_signup__";

const signupContext = z.object({
  nickname: z.string().transform(normalizeNickname).pipe(z.string().min(1)),
  turnstileToken: z.string().min(1).max(4096),
});

export type PasskeyDeps = {
  publicOrigin: string;
  /** 浏览器创建通行密钥时的对话框里显示的站名。 */
  rpName: string;
  verifyTurnstile: TurnstileVerifier;
};

export function passkeyPlugin(deps: PasskeyDeps) {
  return passkey({
    // rpID 上线后不能改：改了所有人已有的通行密钥都会失效。本机是 localhost（不能用 127.0.0.1 访问）。
    rpID: new URL(deps.publicOrigin).hostname,
    rpName: deps.rpName,
    origin: deps.publicOrigin,
    // 没有用户名，登录靠"可被发现的凭据"，所以 residentKey 必须是 required。
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    registration: {
      // 允许没登录时注册（只用通行密钥注册）。这样插件对已登录添加不再检查"刚登录"，由 accountRules 补上。
      requireSession: false,
      // 只在没登录时调用，而且在浏览器创建凭据之前：校验不过就不会在用户的密码管理器里留下
      // 服务端不认识的通行密钥（调研报告第 2.3 节，真实 Chromium 实测）。
      resolveUser: async ({ ctx, context }) => {
        let raw: unknown;
        try {
          raw = JSON.parse(context ?? "");
        } catch {
          throw APIError.from("BAD_REQUEST", ACCOUNT_ERROR_CODES.SIGNUP_INVALID);
        }
        const input = signupContext.safeParse(raw);
        if (!input.success) {
          throw APIError.from("BAD_REQUEST", ACCOUNT_ERROR_CODES.SIGNUP_INVALID);
        }
        // 发给 Turnstile 的是 Cloudflare 给的原始访客 IP，不用 getIP：它把 IPv6 截成 /64（给限流用的）。
        const verdict = await deps.verifyTurnstile(input.data.turnstileToken, turnstileRemoteIp(ctx.request));
        if (verdict === "unavailable") {
          throw APIError.from("SERVICE_UNAVAILABLE", ACCOUNT_ERROR_CODES.SIGNUP_CAPTCHA_UNAVAILABLE);
        }
        if (verdict !== "ok") {
          throw APIError.from("FORBIDDEN", ACCOUNT_ERROR_CODES.SIGNUP_CAPTCHA_FAILED);
        }
        return { id: PASSKEY_SIGNUP, name: input.data.nickname, displayName: input.data.nickname };
      },
      afterVerification: async ({ ctx, user, verification }) => {
        const label = getAuthenticatorName(verification.registrationInfo?.aaguid);
        if (user.id !== PASSKEY_SIGNUP) {
          // 已登录添加：会话必须还是发起时的那个用户（拿到挑战后退出、换了账号再完成的不认）。
          if (ctx.context.session?.user.id !== user.id) {
            throw APIError.from("UNAUTHORIZED", ACCOUNT_ERROR_CODES.REAUTH_REQUIRED);
          }
          return { name: label };
        }
        // 只有 createSession: true 时，插件才把建号、存通行密钥、建会话放进同一个事务。
        if (ctx.body?.createSession !== true) {
          throw APIError.from("BAD_REQUEST", ACCOUNT_ERROR_CODES.SIGNUP_SESSION_REQUIRED);
        }
        // 必须用 internalAdapter 建号：user.create.before 才会生成短 id 和占位邮箱。
        const created = await ctx.context.internalAdapter.createUser(
          { name: user.name, email: "pending@placeholder.invalid", emailVerified: false },
          { method: "passkey" }
        );
        return { userId: created.id, name: label };
      },
    },
    authentication: {
      afterVerification: async ({ ctx, clientData }) => {
        // 这里抛错会让登录失败，所以只记日志。
        try {
          await ctx.context.adapter.update({
            model: "passkey",
            where: [{ field: "credentialID", value: clientData.id }],
            update: { lastUsedAt: new Date() },
          });
        } catch (error) {
          ctx.context.logger.error("passkey_last_used_update_failed", error);
        }
      },
    },
  });
}
