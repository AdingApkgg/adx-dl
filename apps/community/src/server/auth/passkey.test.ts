import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { account, passkey, user } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import {
  ageSessions,
  createTestAuth,
  currentUserId,
  googleProfile,
  signInWithGoogle,
  type TestAuthOptions,
} from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { SoftAuthenticator } from "../testing/soft-authenticator";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";

const RP_ID = new URL(TEST_PUBLIC_ORIGIN).hostname;

// TEST_PUBLIC_ORIGIN 是 https，所以 Cookie 名带 __Secure- 前缀。
const SESSION_COOKIE = "__Secure-adxc.session_token";

// 碰数据库的测试都显式给了 30_000 的超时：测试库在隧道另一端，一个测试要来回十几次，隧道慢的时候 2 到 5 秒
// 不稀奇；默认的 5s 是给本机直连的 Postgres 设的（同 me.test.ts）。
beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

function newApp(options?: TestAuthOptions) {
  return createApp(testAppDeps({ auth: createTestAuth(options).auth }).deps);
}

function signupQuery(nickname: string, turnstileToken = "pass") {
  return `context=${encodeURIComponent(JSON.stringify({ nickname, turnstileToken }))}`;
}

// 只用通行密钥注册；默认带 createSession: true（前端总是这样调）。
async function signUp(browser: Browser, authn: SoftAuthenticator, nickname: string, createSession = true) {
  const options = await browser.request("GET", `/api/auth/passkey/generate-register-options?${signupQuery(nickname)}`);
  const response = await authn.createCredential(options.json);
  return browser.request("POST", "/api/auth/passkey/verify-registration", {
    body: createSession ? { response, createSession: true } : { response },
  });
}

async function signIn(browser: Browser, authn: SoftAuthenticator, credential = authn.credentials.at(-1)) {
  const options = await browser.request("GET", "/api/auth/passkey/generate-authenticate-options");
  return browser.request("POST", "/api/auth/passkey/verify-authentication", {
    body: { response: await authn.getAssertion(options.json, credential) },
  });
}

// 已登录时再加一个通行密钥（不带 context）。
async function addPasskey(browser: Browser, authn: SoftAuthenticator) {
  const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
  if (options.status !== 200) {
    return options;
  }
  return browser.request("POST", "/api/auth/passkey/verify-registration", {
    body: { response: await authn.createCredential(options.json) },
  });
}

function usersNamed(name: string) {
  return testDbHandle().db.select().from(user).where(eq(user.name, name));
}

function passkeysOf(userId: string) {
  return testDbHandle().db.select().from(passkey).where(eq(passkey.userId, userId));
}

function uniqueNickname() {
  return `密钥用户${crypto.randomUUID().slice(0, 8)}`;
}

describe("只用通行密钥注册", () => {
  test("人机验证不过、验证服务不可用、昵称或参数不合法时，拿不到注册选项", async () => {
    const browser = new Browser(newApp());
    const get = (query: string) => browser.request("GET", `/api/auth/passkey/generate-register-options?${query}`);

    const failed = await get(signupQuery("阿丁", "nope"));
    const down = await get(signupQuery("阿丁", "down"));
    const blank = await get(signupQuery("  \u0007 "));
    const garbage = await get("context=not-json");

    expect([failed.status, failed.json.code]).toEqual([403, "SIGNUP_CAPTCHA_FAILED"]);
    expect([down.status, down.json.code]).toEqual([503, "SIGNUP_CAPTCHA_UNAVAILABLE"]);
    expect([blank.status, blank.json.code]).toEqual([400, "SIGNUP_INVALID"]);
    expect([garbage.status, garbage.json.code]).toEqual([400, "SIGNUP_INVALID"]);
  });

  // Better Auth 自己的 getIP 会把 IPv6 截成 /64（给限流用的），那样发给 Cloudflare 的就不是访客的真实地址了。
  test("人机验证收到的是访客的原始 IP：IPv6 不截成 /64", async () => {
    const seen: (string | null)[] = [];
    const app = newApp({
      turnstile: async (token, remoteIp) => {
        seen.push(remoteIp);
        return token === "pass" ? "ok" : "failed";
      },
    });
    const browser = new Browser(app, { ip: "2001:db8:1:2:3:4:5:6" });

    const res = await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());

    expect(res.status).toBe(200);
    expect(seen).toEqual(["2001:db8:1:2:3:4:5:6"]);
  }, 30_000);

  test("没带 createSession 时拒绝，而且不建号", async () => {
    const nickname = uniqueNickname();

    const res = await signUp(new Browser(newApp()), new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), nickname, false);

    expect([res.status, res.json.code]).toEqual([400, "SIGNUP_SESSION_REQUIRED"]);
    expect(await usersNamed(nickname)).toEqual([]);
  }, 30_000);

  test("注册成功：一个新用户（短 id、占位邮箱、昵称），通行密钥挂在他名下，同时登录", async () => {
    const browser = new Browser(newApp());
    const nickname = uniqueNickname();

    const res = await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), nickname);

    expect(res.status).toBe(200);
    const userId = await currentUserId(browser);
    expect(userId).toMatch(/^[2-9a-hjkmnp-z]{10}$/);
    expect(await usersNamed(nickname)).toEqual([
      expect.objectContaining({ id: userId, email: `${userId}@placeholder.invalid` }),
    ]);
    expect(await passkeysOf(userId)).toHaveLength(1);
  }, 30_000);

  // credential_id 全表唯一。插件先建号再存通行密钥，存的时候撞上唯一约束，整个事务回滚。
  test("同一个凭据不能再注册一个账号；失败时不留下空用户", async () => {
    const app = newApp();
    const authn = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    await signUp(new Browser(app), authn, uniqueNickname());
    const reusedId = authn.credentials[0]?.id;
    const nickname = uniqueNickname();

    const browser = new Browser(app);
    const options = await browser.request("GET", `/api/auth/passkey/generate-register-options?${signupQuery(nickname)}`);
    const response = await authn.createCredential(options.json, reusedId);
    const res = await browser.request("POST", "/api/auth/passkey/verify-registration", {
      body: { response, createSession: true },
    });

    expect(res.status).not.toBe(200);
    expect(await usersNamed(nickname)).toEqual([]);
  }, 30_000);
});

describe("通行密钥登录和管理", () => {
  test("登录，并记下最后使用时间", async () => {
    const app = newApp();
    const authn = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    const first = new Browser(app);
    await signUp(first, authn, uniqueNickname());
    const userId = await currentUserId(first);

    const second = new Browser(app);
    const res = await signIn(second, authn);

    expect(res.status).toBe(200);
    expect(await currentUserId(second)).toBe(userId);
    const [row] = await passkeysOf(userId);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  }, 30_000);

  test("已登录添加：注册选项里的用户名是昵称，不是占位邮箱；超过 10 分钟要求重新登录", async () => {
    const browser = new Browser(newApp());
    const nickname = uniqueNickname();
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), nickname);
    const userId = await currentUserId(browser);

    const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
    expect(options.json.user).toMatchObject({ name: nickname, displayName: nickname });
    const laptop = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    const added = await browser.request("POST", "/api/auth/passkey/verify-registration", {
      body: { response: await laptop.createCredential(options.json) },
    });
    expect(added.status).toBe(200);
    expect(await passkeysOf(userId)).toHaveLength(2);

    await ageSessions(userId, 11);
    const stale = await addPasskey(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    expect([stale.status, stale.json.code]).toEqual([403, "REAUTH_REQUIRED"]);
  }, 30_000);

  test("删除：要求刚登录过；不能删最后一种登录方式；id 不是 uuid 时返回 404 而不是 500", async () => {
    const browser = new Browser(newApp());
    const phone = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    await signUp(browser, phone, uniqueNickname());
    const userId = await currentUserId(browser);
    await addPasskey(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    const [firstKey, secondKey] = await passkeysOf(userId);
    const remove = (id: string | undefined) =>
      browser.request("POST", "/api/auth/passkey/delete-passkey", { body: { id } });

    await ageSessions(userId, 11);
    const stale = await remove(secondKey?.id);
    expect([stale.status, stale.json.code]).toEqual([403, "REAUTH_REQUIRED"]);

    await signIn(browser, phone, phone.credentials[0]);
    expect((await remove(secondKey?.id)).status).toBe(200);
    const last = await remove(firstKey?.id);
    expect([last.status, last.json.code]).toEqual([400, "LAST_LOGIN_METHOD"]);
    expect((await remove("not-a-uuid")).status).toBe(404);
  }, 30_000);

  // allowUnlinkingAll 设成 true 的原因：Better Auth 只数平台绑定，会拒绝这种解绑。
  test("有通行密钥时，唯一的 Google 绑定可以解绑", async () => {
    const browser = new Browser(newApp());
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    await addPasskey(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    const [google] = await testDbHandle().db.select().from(account).where(eq(account.userId, userId));

    const res = await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: google?.id } });

    expect(res.status).toBe(200);
    expect(await testDbHandle().db.select().from(account).where(eq(account.userId, userId))).toEqual([]);
    expect(await passkeysOf(userId)).toHaveLength(1);
  }, 30_000);
});

describe("Bearer 会话也要过通行密钥的规则", () => {
  // before-hook 之间互相看不到彼此对 context 的改动（hook-session.ts 顶部注释）：账号规则如果直接用
  // getSessionFromCtx，纯 Bearer 请求会被误判成"没登录"，放过"会话 10 分钟内创建"的检查；
  // 之后端点自己处理请求时又认得出这个 Bearer 会话，于是旧会话照样能拿到注册选项。
  test("Bearer 添加通行密钥：刚登录时给选项，会话超过 10 分钟要求重新登录", async () => {
    const app = newApp();
    const browser = new Browser(app);
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    const userId = await currentUserId(browser);
    const token = decodeURIComponent(browser.cookies.get(SESSION_COOKIE) ?? "");
    const generate = () =>
      app.request("/api/auth/passkey/generate-register-options", { headers: { authorization: `Bearer ${token}` } });

    // 对照：会话刚创建时，同样的 Bearer 请求是拿得到选项的（所以下面的 403 只来自"不够新"）。
    expect((await generate()).status).toBe(200);

    await ageSessions(userId, 11);
    const stale = await generate();

    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { code: string }).code).toBe("REAUTH_REQUIRED");
  }, 30_000);
});
