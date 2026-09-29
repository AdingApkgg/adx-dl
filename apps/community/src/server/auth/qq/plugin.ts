import { APIError, type BetterAuthPlugin, defineErrorCodes } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { constantTimeEqual, generateRandomString } from "better-auth/crypto";
import { z } from "zod";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

import { ACCOUNT_ERROR_CODES } from "../account-rules";
import { isRecentLogin } from "../recent-login";
import { type TurnstileVerifier, turnstileRemoteIp } from "../turnstile";
import type { QqCodeStore } from "./codes";
import type { QqHasher } from "./hasher";
import { maskQq, type QqSender } from "./sender";

export const QQ_ERROR_CODES = defineErrorCodes({
  QQ_CAPTCHA_FAILED: "Captcha verification failed",
  QQ_CAPTCHA_UNAVAILABLE: "Captcha verification is temporarily unavailable",
  QQ_SEND_RATE_LIMITED: "Too many codes requested for this QQ number",
  QQ_CODE_EXPIRED: "Verification code expired or was not requested in this browser",
  QQ_CODE_INVALID: "Invalid verification code",
  QQ_CODE_TOO_MANY_ATTEMPTS: "Too many wrong attempts, request a new code",
  QQ_LINK_REQUIRES_SESSION: "Sign in before linking a QQ account",
  QQ_ALREADY_LINKED: "This QQ account is linked to another user",
});

export type QqLoginDeps = {
  codes: QqCodeStore;
  sender: QqSender;
  hasher: QqHasher;
  verifyTurnstile: TurnstileVerifier;
  log: Logger;
};

// 5 到 11 位数字，不以 0 开头（spec 第 10.3 节）。
const qqNumber = z.string().regex(/^[1-9]\d{4,10}$/);
const CODE_TTL_SEC = 300;
const MAX_ATTEMPTS = 5;
const COOKIE = "qq_code";

export function qqLogin(deps: QqLoginDeps) {
  return {
    id: "qq-login",
    endpoints: {
      // 端点的 key 会并进 auth.api，和别的插件重名时会被静默覆盖，所以起得具体一点。
      sendQqCode: createAuthEndpoint(
        "/qq/send-code",
        {
          method: "POST",
          body: z.object({
            qq: qqNumber,
            turnstileToken: z.string().min(1).max(4096),
            locale: z.enum(["zh", "en", "ja"]).default("zh"),
          }),
        },
        async (ctx) => {
          const { qq, turnstileToken, locale } = ctx.body;
          const verdict = await deps.verifyTurnstile(turnstileToken, turnstileRemoteIp(ctx.request));
          if (verdict === "unavailable") {
            throw APIError.from("SERVICE_UNAVAILABLE", QQ_ERROR_CODES.QQ_CAPTCHA_UNAVAILABLE);
          }
          if (verdict !== "ok") {
            throw APIError.from("FORBIDDEN", QQ_ERROR_CODES.QQ_CAPTCHA_FAILED);
          }
          const qqKey = await deps.hasher.qqKey(qq);
          if (!(await deps.codes.allowSend(qqKey))) {
            throw APIError.from("TOO_MANY_REQUESTS", QQ_ERROR_CODES.QQ_SEND_RATE_LIMITED);
          }

          const code = generateRandomString(6, "0-9");
          const nonce = generateRandomString(32);
          await deps.codes.save(nonce, { qqKey, codeHash: await deps.hasher.codeHash(nonce, qq, code) }, CODE_TTL_SEC);
          // 用一个短期的签名 Cookie 把这次发码和当前浏览器绑在一起。
          const cookie = ctx.context.createAuthCookie(COOKIE);
          await ctx.setSignedCookie(cookie.name, nonce, ctx.context.secret, { ...cookie.attributes, maxAge: CODE_TTL_SEC });
          // 不等发送结果：对方没加好友时 NapCat 要等到超时；响应的快慢也会暴露"对方是不是好友"。
          ctx.context.runInBackground(
            deps.sender.sendCode(qq, code, locale).catch((error) => deps.log.error("qq_send_failed", describeError(error)))
          );
          // 不管实际有没有发出去，都返回同样的结果（spec 第 10.3 节）。
          return ctx.json({ status: true as const });
        }
      ),

      verifyQqCode: createAuthEndpoint(
        "/qq/verify",
        {
          method: "POST",
          body: z.object({
            qq: qqNumber,
            code: z.string().regex(/^\d{6}$/),
            intent: z.enum(["login", "link"]).default("login"),
          }),
        },
        async (ctx) => {
          const { qq, code, intent } = ctx.body;
          // 绑定要先确认已登录，再去碰验证码：否则没登录的请求会白白用掉一次尝试。
          const session = intent === "link" ? await getSessionFromCtx(ctx) : null;
          if (intent === "link" && !session) {
            throw APIError.from("UNAUTHORIZED", QQ_ERROR_CODES.QQ_LINK_REQUIRES_SESSION);
          }
          // 绑定新的登录方式也算敏感操作，和 /link-social 一样要求 10 分钟内刚登录：否则偷来的旧会话能绑一个
          // 攻击者自己的 QQ，再用它正常登录一次，之后就有了一个"刚登录"的会话。
          if (session && !isRecentLogin(session.session.createdAt)) {
            throw APIError.from("FORBIDDEN", ACCOUNT_ERROR_CODES.REAUTH_REQUIRED);
          }

          const cookie = ctx.context.createAuthCookie(COOKIE);
          // 签名不对时返回 false，没有这个 Cookie 时返回 null。
          const nonce = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          if (!nonce) {
            throw APIError.from("BAD_REQUEST", QQ_ERROR_CODES.QQ_CODE_EXPIRED);
          }
          // 比对之前先原子地占用一次尝试机会（见 QqCodeStore.claimAttempt）：并发的请求各拿一个次数，
          // 超过上限的一律不比对。记录不在、或者不是发给这个 QQ 号的，不占次数。
          const claim = await deps.codes.claimAttempt(nonce, await deps.hasher.qqKey(qq));
          if (!claim) {
            throw APIError.from("BAD_REQUEST", QQ_ERROR_CODES.QQ_CODE_EXPIRED);
          }
          if (claim.attempts > MAX_ATTEMPTS) {
            await deps.codes.consume(nonce);
            throw APIError.from("BAD_REQUEST", QQ_ERROR_CODES.QQ_CODE_TOO_MANY_ATTEMPTS);
          }
          if (!constantTimeEqual(await deps.hasher.codeHash(nonce, qq, code), claim.codeHash)) {
            if (claim.attempts >= MAX_ATTEMPTS) {
              await deps.codes.consume(nonce);
              throw APIError.from("BAD_REQUEST", QQ_ERROR_CODES.QQ_CODE_TOO_MANY_ATTEMPTS);
            }
            throw APIError.from("BAD_REQUEST", QQ_ERROR_CODES.QQ_CODE_INVALID);
          }
          // 验证通过立即作废；两个请求同时带着正确的验证码进来时，只有一个能往下走。
          if (!(await deps.codes.consume(nonce))) {
            throw APIError.from("BAD_REQUEST", QQ_ERROR_CODES.QQ_CODE_EXPIRED);
          }
          expireCookie(ctx, cookie);

          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey({ providerId: "qq", accountId: qq });

          if (session) {
            if (owner && owner.account.userId !== session.user.id) {
              throw APIError.from("CONFLICT", QQ_ERROR_CODES.QQ_ALREADY_LINKED);
            }
            if (!owner) {
              // 附加字段不在 internalAdapter 的参数类型里，放进变量再展开，绕过多余属性检查。
              const profile = { providerNickname: await deps.sender.lookupNickname(qq) };
              await ctx.context.internalAdapter.linkAccount({
                userId: session.user.id,
                providerId: "qq",
                accountId: qq,
                ...profile,
              });
            }
            return ctx.json({ linked: true as const });
          }

          let user = owner?.kind === "owned" ? owner.user : null;
          const isNewUser = user === null;
          if (!user) {
            // 查昵称是网络请求，放在建号的事务外面。
            const nickname = await deps.sender.lookupNickname(qq);
            // 绑定上只存真的查到的昵称（登录方式列表把它当"QQ 昵称"显示，存打码的号会误导），查不到就是 null；
            // 打码的 QQ 号只用作用户的显示名。
            const profile = { providerNickname: nickname };
            // createOAuthUser 在一个事务里建用户和绑定；短 id 和占位邮箱由 user.create.before 生成。
            const created = await ctx.context.internalAdapter.createOAuthUser(
              { name: nickname ?? `QQ ${maskQq(qq)}`, email: "pending@placeholder.invalid", emailVerified: false },
              { providerId: "qq", accountId: qq, ...profile }
            );
            user = created.user;
          }
          const newSession = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session: newSession, user });
          return ctx.json({ user: { id: user.id, name: user.name }, isNewUser });
        }
      ),
    },
    // Better Auth 自带的限流只能按"IP + 路径"计数（按 QQ 号的在 codes.allowSend 里做）。
    // 它只在 rateLimit.enabled 时生效，也就是线上。
    rateLimit: [
      { pathMatcher: (path) => path === "/qq/send-code", window: 3600, max: 20 },
      { pathMatcher: (path) => path === "/qq/verify", window: 60, max: 10 },
    ],
    $ERROR_CODES: QQ_ERROR_CODES,
  } satisfies BetterAuthPlugin;
}
