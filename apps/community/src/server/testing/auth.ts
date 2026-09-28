import { sql } from "drizzle-orm";

import { createLogger } from "@/shared/log";

import { createAuth } from "../auth/auth";
import { createMemoryRateLimitStore, type RateLimitStore } from "../middleware/rate-limit";
import type { Browser } from "./auth-browser";
import { TEST_AUTH_SECRET, TEST_GOOGLE_CLIENT_ID, TEST_PUBLIC_ORIGIN } from "./constants";
import { testDbHandle } from "./test-db";

export type TestAuthOptions = {
  rateLimitEnabled?: boolean;
  rateLimitStore?: RateLimitStore;
};

// 连测试库的 auth 实例。每个实例有自己的内存限流计数，互不影响。
export function createTestAuth(options: TestAuthOptions = {}) {
  const lines: string[] = [];
  const auth = createAuth({
    db: testDbHandle().db,
    log: createLogger((line) => lines.push(line)),
    publicOrigin: TEST_PUBLIC_ORIGIN,
    secret: TEST_AUTH_SECRET,
    google: { clientId: TEST_GOOGLE_CLIENT_ID, clientSecret: "test-google-client-secret" },
    rateLimitStore: options.rateLimitStore ?? createMemoryRateLimitStore(),
    rateLimitEnabled: options.rateLimitEnabled ?? false,
  });
  return { auth, logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
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
