import { sql } from "drizzle-orm";

import { createLogger } from "@/shared/log";

import { createAuth } from "../auth/auth";
import { createRedisQqCodeStore } from "../auth/qq/codes";
import { createQqHasher } from "../auth/qq/hasher";
import type { QqSender } from "../auth/qq/sender";
import type { TurnstileVerifier } from "../auth/turnstile";
import { createMemoryRateLimitStore, type RateLimitStore } from "../middleware/rate-limit";
import type { Browser } from "./auth-browser";
import { TEST_AUTH_SECRET, TEST_GOOGLE_CLIENT_ID, TEST_PUBLIC_ORIGIN } from "./constants";
import { testDbHandle } from "./test-db";
import { testRedis } from "./test-redis";

export type TestAuthOptions = {
  rateLimitEnabled?: boolean;
  rateLimitStore?: RateLimitStore;
  /** 默认：令牌 "pass" 通过，"down" 当作 Cloudflare 不可用，其余不通过。 */
  turnstile?: TurnstileVerifier;
  /** 记录型发送器查昵称时的结果（QQ 号 → 昵称），不在表里的返回 null。 */
  nicknames?: Record<string, string>;
  /** 按 QQ 号限流用的计数存储。默认是每个实例一份新的内存计数。 */
  qqLimits?: RateLimitStore;
};

export type SentCode = { qq: string; code: string; locale: string };

export const fakeTurnstile: TurnstileVerifier = async (token) =>
  token === "pass" ? "ok" : token === "down" ? "unavailable" : "failed";

/** 永远放行的计数存储：测试里要对同一个 QQ 号连续发码时用。 */
export const UNLIMITED: RateLimitStore = { hit: async () => ({ count: 1, resetSec: 60 }) };

// 连测试库和测试 Redis 的 auth 实例。每个实例有自己的内存限流计数和验证码键前缀，互不影响；
// QQ 验证码不真的发出去，而是记进返回的 outbox。
export function createTestAuth(options: TestAuthOptions = {}) {
  const lines: string[] = [];
  const outbox: SentCode[] = [];
  const nicknames = options.nicknames ?? {};
  const sender: QqSender = {
    async sendCode(qq, code, locale) {
      outbox.push({ qq, code, locale });
    },
    async lookupNickname(qq) {
      return nicknames[qq] ?? null;
    },
  };
  const auth = createAuth({
    db: testDbHandle().db,
    log: createLogger((line) => lines.push(line)),
    publicOrigin: TEST_PUBLIC_ORIGIN,
    secret: TEST_AUTH_SECRET,
    google: { clientId: TEST_GOOGLE_CLIENT_ID, clientSecret: "test-google-client-secret" },
    rateLimitStore: options.rateLimitStore ?? createMemoryRateLimitStore(),
    rateLimitEnabled: options.rateLimitEnabled ?? false,
    verifyTurnstile: options.turnstile ?? fakeTurnstile,
    qq: {
      codes: createRedisQqCodeStore({
        // 用到时才连：createTestAuth 保持同步。
        redis: { send: async (command, args) => (await testRedis()).send(command, args) },
        limits: options.qqLimits ?? createMemoryRateLimitStore(),
        prefix: `test:${crypto.randomUUID()}:qq:`,
      }),
      sender,
      hasher: createQqHasher("test-hmac-test-hmac-test-hmac-test-hmac"),
    },
  });
  return { auth, outbox, logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

// ---- 冒充 Google：替换 globalThis.fetch 里换令牌的那一步，测试不连网 ----
// 回调流程只解码 id_token、不验签（调研报告第 7 题），未签名的令牌就够了。

export type GoogleProfile = { sub: string; email: string; email_verified: boolean; name: string; picture?: string };

export function googleProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  const sub = `g-${crypto.randomUUID()}`;
  return { sub, email: `${sub}@gmail.com`, email_verified: true, name: "Google 用户", ...overrides };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeIdToken(profile: GoogleProfile): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "RS256", kid: "test", typ: "JWT" });
  const payload = base64url({ iss: "https://accounts.google.com", aud: TEST_GOOGLE_CLIENT_ID, iat: now, exp: now + 3600, ...profile });
  return `${header}.${payload}.signature`;
}

// Better Auth 每次发请求时才读 globalThis.fetch，测试中途替换有效。返回还原函数。
export function installFakeGoogle(profile: GoogleProfile): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "ya29.fake",
        id_token: fakeIdToken(profile),
        expires_in: 3599,
        token_type: "Bearer",
        scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
      });
    }
    throw new Error(`unexpected network call in a test: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** 1b 里新用户先去账号设置页（见本计划"与 spec 的偏离"第 8 条）。 */
export const NEW_USER_CALLBACK = "/settings/account?welcome=1";

// 走一遍 Google 登录或绑定：sign-in/social（或 link-social）→ 冒充 Google → 回调。返回回调的响应。
export async function signInWithGoogle(
  browser: Browser,
  profile: GoogleProfile,
  options: { link?: boolean; callbackURL?: string } = {}
) {
  const path = options.link ? "/api/auth/link-social" : "/api/auth/sign-in/social";
  const start = await browser.request("POST", path, {
    body: {
      provider: "google",
      callbackURL: options.callbackURL ?? "/",
      newUserCallbackURL: NEW_USER_CALLBACK,
      errorCallbackURL: "/login",
    },
  });
  const url = start.json?.url;
  if (typeof url !== "string") {
    throw new Error(`${path} returned ${start.status}: ${start.text}`);
  }
  const state = new URL(url).searchParams.get("state") ?? "";
  const restore = installFakeGoogle(profile);
  try {
    // 从 Google 跳回来是顶层 GET 导航，浏览器不带 Origin。
    return await browser.request("GET", `/api/auth/callback/google?code=fake-code&state=${encodeURIComponent(state)}`, {
      origin: null,
    });
  } finally {
    restore();
  }
}

export async function currentUserId(browser: Browser): Promise<string> {
  const res = await browser.request("GET", "/api/auth/get-session");
  const id = res.json?.user?.id;
  if (typeof id !== "string") {
    throw new Error(`not signed in: ${res.status} ${res.text}`);
  }
  return id;
}

// 把这个用户的所有会话改成 minutes 分钟前创建，用来测"10 分钟内刚登录"。
export async function ageSessions(userId: string, minutes: number): Promise<void> {
  await testDbHandle().db.execute(
    sql`update session set created_at = now() - make_interval(mins => ${minutes}::int) where user_id = ${userId}`
  );
}

// ---- QQ ----

/** 随机的 10 到 11 位 QQ 号，不以 0 开头。测试之间共用测试库，所以不要用固定的号码。 */
export function randomQq(): string {
  return String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999));
}

/** 等后台发码跑完，返回 outbox 里 after 之后发给这个 QQ 的最新验证码。 */
export async function waitForCode(outbox: SentCode[], qq: string, after = 0): Promise<string> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const hit = outbox.slice(after).findLast((entry) => entry.qq === qq);
    if (hit) {
      return hit.code;
    }
    if (Date.now() > deadline) {
      throw new Error("no code was sent in time");
    }
    await Bun.sleep(5);
  }
}

/** 用 QQ 验证码登录（发码 → 取验证码 → 验证），返回验证接口的响应。 */
export async function signInWithQq(browser: Browser, outbox: SentCode[], qq = randomQq()) {
  const before = outbox.length;
  const sent = await browser.request("POST", "/api/auth/qq/send-code", { body: { qq, turnstileToken: "pass" } });
  if (sent.status !== 200) {
    throw new Error(`send-code returned ${sent.status}: ${sent.text}`);
  }
  const code = await waitForCode(outbox, qq, before);
  const verified = await browser.request("POST", "/api/auth/qq/verify", { body: { qq, code } });
  return { qq, verified };
}
