import { betterAuth, type BetterAuthRateLimitStorage } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, isAPIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";
import { normalizeNickname } from "@/shared/nickname";

import type { Db } from "../db/client";
import * as schema from "../db/schema";
import type { RateLimitStore } from "../middleware/rate-limit";
import { withTimeout } from "../with-timeout";
import { accountRules } from "./account-rules";
import { accountAdditionalFields, sessionAdditionalFields, userAdditionalFields } from "./fields";
import { passkeyPlugin } from "./passkey";
import type { QqCodeStore } from "./qq/codes";
import type { QqHasher } from "./qq/hasher";
import { qqLogin } from "./qq/plugin";
import type { QqSender } from "./qq/sender";
import { shortId } from "./short-id";
import type { TurnstileVerifier } from "./turnstile";

export type AuthDeps = {
  db: Db;
  log: Logger;
  /** 浏览器看到的站点地址（PUBLIC_ORIGIN）：Better Auth 的 baseURL、可信来源、通行密钥的 rpID 都从它来。 */
  publicOrigin: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  /** Better Auth 自带限流的计数存储。线上和 /api/* 的限流共用 Redis，测试用内存。 */
  rateLimitStore: RateLimitStore;
  /** Better Auth 自带的限流默认只在 NODE_ENV=production 时开；测试要测它就显式传 true。 */
  rateLimitEnabled: boolean;
  /** QQ 发码、只用通行密钥注册之前的人机验证。 */
  verifyTurnstile: TurnstileVerifier;
  qq: { codes: QqCodeStore; sender: QqSender; hasher: QqHasher };
};

// Better Auth 自带限流的存储：一次原子的 consume。复用 1a 的计数存储，Redis 卡住或出错时放行，
// 和 /api/* 的限流中间件一致。
function rateLimitStorage(store: RateLimitStore, log: Logger): BetterAuthRateLimitStorage {
  return {
    async consume(key, rule) {
      try {
        const hit = await withTimeout(store.hit(`rl:ba:${key}`, rule.window), 250);
        return hit.count <= rule.max
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: Math.max(hit.resetSec, 1) };
      } catch (error) {
        log.error("rate_limit_store_error", describeError(error));
        return { allowed: true, retryAfter: null };
      }
    },
  };
}

// account 表上第三方令牌相关的列：create 和 update 两个钩子都要把它们清空（见下面 databaseHooks.account）。
const TOKEN_FIELDS = ["accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt"] as const;

// Google 回调时 Better Auth 从令牌接口直接拿到 id_token，这里只解出 email，不需要验签。
function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export function createAuth(deps: AuthDeps) {
  const { db, log } = deps;
  return betterAuth({
    appName: "AstroDX Community",
    baseURL: deps.publicOrigin,
    basePath: "/api/auth",
    secret: deps.secret,
    trustedOrigins: [deps.publicOrigin],
    telemetry: { enabled: false },
    logger: {
      level: "warn",
      log: (level, message, ...args) => {
        // 参数可能是带 SQL 参数值的数据库错误，只经 describeError 取安全的字段。
        const detail = args[0] instanceof Error ? describeError(args[0]) : {};
        const write = level === "error" || level === "warn" ? log.error : log.info;
        write("better_auth", { level, message, ...detail });
      },
    },
    // transaction：Google 新用户的"建用户 + 建绑定"、通行密钥注册的"建号 + 存密钥 + 建会话"都要原子。
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    // 不配 secondaryStorage：会话和 verification 只存 PG（见本计划"与 spec 的偏离"第 2 条）。
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: userAdditionalFields,
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      additionalFields: sessionAdditionalFields,
    },
    account: {
      // 否则同一个 Google 账号再次登录时，令牌会被写回库里。
      updateAccountOnSignIn: false,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        // 本地都是占位邮箱，不开的话所有绑定都会因为"邮箱不一致"失败。
        allowDifferentEmails: true,
        updateUserInfoOnLink: false,
        // "平台绑定 + 通行密钥至少留一个"由 accountRules 自己数；Better Auth 只数平台绑定。
        allowUnlinkingAll: true,
        // 不加的话，绑定一个邮箱未验证的 Google 账号会失败。
        trustedProviders: ["google"],
      },
      additionalFields: accountAdditionalFields,
    },
    rateLimit: {
      enabled: deps.rateLimitEnabled,
      customStorage: rateLimitStorage(deps.rateLimitStore, log),
    },
    advanced: {
      // 上线后不能改：改了等于让所有人重新登录。
      cookiePrefix: "adxc",
      // 只有 cloudflared 能连进来（端口只绑本机），这个头可信；不配的话限流时所有人共用一个计数。
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // 显式写上：bun test（NODE_ENV=test）下这两项默认是关的，测试就和线上不一致了。
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: {
        // user 用 10 位短 id；其余表返回 false，由数据库的 uuidv7() 生成。
        generateId: ({ model }) => (model === "user" ? shortId() : false),
        // 读会话时用一条 SQL 连带取出用户（schema 里的 relations 就是为它准备的）。
        joins: true,
      },
    },
    onAPIError: {
      // OAuth 回调在读到 state 之前出错时跳到这里（带 ?error=…），不用 Better Auth 自带的错误页。
      errorURL: `${deps.publicOrigin}/login`,
      // 不接管的话，钩子里抛出的错误会被 Better Auth 用它自己的格式打到控制台。
      onError: (error) => {
        if (isAPIError(error) && error.statusCode < 500) {
          return;
        }
        log.error("better_auth_error", describeError(error));
      },
    },
    // 只挡 HTTP 入口（返回 404），服务端的 auth.api.* 照样能调。只支持精确路径。
    disabledPaths: [
      // 资料修改走我们自己的接口：它不校验昵称和头像地址。
      "/update-user",
      "/update-session",
      // 注销走 spec 第 10.6 节的流程（1c）。
      "/delete-user",
      "/delete-user/callback",
      "/change-email",
      // 登录设备用 /api/v1/me/sessions：/list-sessions 会把所有设备的会话令牌发给页面。
      "/list-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
      // 不存第三方令牌。
      "/refresh-token",
      "/get-access-token",
      "/account-info",
      // 没有邮箱密码登录。
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/reset-password",
      "/verify-password",
      "/change-password",
      "/send-verification-email",
      "/verify-email",
      // 已经用 onAPIError.errorURL 指到 /login。
      "/error",
    ],
    databaseHooks: {
      user: {
        create: {
          // 钩子里拿不到 Better Auth 生成的 id（调研实测），所以在这里自己生成，同时写占位邮箱。
          // 不先查 id 有没有被占用：这个钩子跑在建号的事务里（通行密钥注册、Google 新用户），查重要从连接池
          // 另占一个连接；同时进来"池大小 + 1"个新用户时，事务全都占着一个连接在等第二个，互相等死。
          // 31^10 ≈ 8.2×10^14 个 id 里撞上已有 id 的概率约为"用户数 ÷ 8.2×10^14"，真撞上了，主键约束
          // 让这一次建号失败（500），用户重试即可。spec 写的"插入冲突时重试"做不到：失败时 Better Auth 的
          // 流程已经中断。唯一性由主键保证。
          before: async (data) => {
            const id = shortId();
            return {
              data: {
                ...data,
                id,
                email: `${id}@placeholder.invalid`,
                emailVerified: false,
                // Google 会带头像地址进来；子项目 2 之前一律为空。
                image: null,
                name: normalizeNickname(data.name) || id,
              },
            };
          },
        },
        update: {
          // 保险：任何路径都不许改 email。
          before: async (data) => {
            if ("email" in data) {
              throw new APIError("BAD_REQUEST", { code: "EMAIL_IMMUTABLE", message: "Email cannot be changed" });
            }
            return { data };
          },
        },
      },
      account: {
        create: {
          before: async (data) => {
            const providerEmail =
              data.providerId === "google" && data.idToken ? emailFromIdToken(data.idToken) : undefined;
            return {
              data: {
                ...data,
                ...(providerEmail !== undefined ? { providerEmail } : {}),
                // 用不到 Google 的令牌，一律不存。
                accessToken: null,
                refreshToken: null,
                idToken: null,
                accessTokenExpiresAt: null,
                refreshTokenExpiresAt: null,
              },
            };
          },
        },
        update: {
          // 重新绑定已经绑过的 Google 账号时，linkOAuthAccount 会带着新的令牌调 update（不会走
          // 上面的 create.before）：同样一律清空，没出现在这次更新里的列不动。
          before: async (data) => {
            const cleared: Record<string, null> = {};
            for (const field of TOKEN_FIELDS) {
              if (field in data) {
                cleared[field] = null;
              }
            }
            return { data: { ...data, ...cleared } };
          },
        },
      },
      session: {
        create: {
          // Google 回调、QQ、通行密钥建的会话都经过这里。
          before: async (data, ctx) => {
            const country = ctx?.request?.headers.get("cf-ipcountry") ?? ctx?.headers?.get("cf-ipcountry") ?? null;
            return { data: { ...data, country } };
          },
        },
      },
    },
    socialProviders: {
      google: {
        clientId: deps.google.clientId,
        clientSecret: deps.google.clientSecret,
        // 浏览器里登着多个 Google 账号时，登录和绑定都让用户选。
        prompt: "select_account",
      },
    },
    // 顺序有要求：accountRules 要排在 passkeyPlugin 后面（见 account-rules.ts）。
    plugins: [
      bearer({ requireSignature: true }),
      passkeyPlugin({
        publicOrigin: deps.publicOrigin,
        rpName: "AstroDX Community",
        verifyTurnstile: deps.verifyTurnstile,
      }),
      accountRules({ db }),
      qqLogin({ ...deps.qq, verifyTurnstile: deps.verifyTurnstile, log }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
