import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createApp } from "../app";
import { account, session, user } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import {
  ageSessions,
  createTestAuth,
  currentUserId,
  googleProfile,
  NEW_USER_CALLBACK,
  signInWithGoogle,
  type TestAuthOptions,
} from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";

// TEST_PUBLIC_ORIGIN 是 https，所以 Cookie 名带 __Secure- 前缀。
const SESSION_COOKIE = "__Secure-adxc.session_token";

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

function newApp(options?: TestAuthOptions) {
  return createApp(testAppDeps({ auth: createTestAuth(options).auth }).deps);
}

function accountsOf(userId: string) {
  return testDbHandle().db.select().from(account).where(eq(account.userId, userId));
}

describe("Google 登录", () => {
  test("第一次登录：建用户和绑定，跳到新用户页；令牌一概不存", async () => {
    const browser = new Browser(newApp());
    const profile = googleProfile({
      name: "  超级长的名字\u0007abcdefghijklmnopqrstuvwxyz0123456789  ",
      email: "Someone@Gmail.com",
      picture: "https://lh3.googleusercontent.com/a/x",
    });

    const callback = await signInWithGoogle(browser, profile);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(NEW_USER_CALLBACK);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(true);

    const userId = await currentUserId(browser);
    expect(userId).toMatch(/^[2-9a-hjkmnp-z]{10}$/);
    const [row] = await testDbHandle().db.select().from(user).where(eq(user.id, userId));
    expect(row).toMatchObject({
      email: `${userId}@placeholder.invalid`,
      image: null,
      name: "超级长的名字abcdefghijklmnopqr",
      status: "active",
    });

    const [binding] = await accountsOf(userId);
    expect(binding).toMatchObject({
      providerId: "google",
      accountId: profile.sub,
      providerEmail: "Someone@Gmail.com",
      accessToken: null,
      refreshToken: null,
      idToken: null,
    });

    const [sessionRow] = await testDbHandle().db.select().from(session).where(eq(session.userId, userId));
    expect(sessionRow).toMatchObject({ country: "JP", ipAddress: "203.0.113.7" });
  });

  test("同一个 Google 账号再次登录是同一个用户，令牌也不会被写回", async () => {
    const app = newApp();
    const profile = googleProfile();
    const first = new Browser(app);
    await signInWithGoogle(first, profile);
    const second = new Browser(app);

    const callback = await signInWithGoogle(second, profile);

    expect(callback.headers.get("location")).toBe("/");
    expect(await currentUserId(second)).toBe(await currentUserId(first));
    const bindings = await testDbHandle()
      .db.select()
      .from(account)
      .where(and(eq(account.providerId, "google"), eq(account.accountId, profile.sub)));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ accessToken: null, idToken: null });
  });

  test("网页响应里没有 set-auth-token；同一个令牌放进 Authorization 头也能认出会话", async () => {
    const app = newApp();
    const browser = new Browser(app);
    const callback = await signInWithGoogle(browser, googleProfile());
    expect(callback.headers.get("set-auth-token")).toBeNull();

    // 会话 Cookie 的值就是签过名的令牌（URL 编码过）；App 以后用 Bearer 带它。
    const token = decodeURIComponent(browser.cookies.get(SESSION_COOKIE) ?? "");
    const res = await app.request("/api/auth/get-session", { headers: { authorization: `Bearer ${token}` } });

    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(await currentUserId(browser));
  });

  test("绑定：已登录时给自己加一个 Google；已经绑在别人名下的不能再绑", async () => {
    const app = newApp();
    const alice = new Browser(app);
    const bob = new Browser(app);
    const alicesGoogle = googleProfile();
    await signInWithGoogle(alice, alicesGoogle);
    await signInWithGoogle(bob, googleProfile());

    const linked = await signInWithGoogle(alice, googleProfile(), { link: true, callbackURL: "/settings/account" });
    expect(linked.headers.get("location")).toBe("/settings/account");
    expect(await accountsOf(await currentUserId(alice))).toHaveLength(2);

    const conflict = await signInWithGoogle(bob, alicesGoogle, { link: true, callbackURL: "/settings/account" });
    expect(conflict.headers.get("location")).toContain("error=account_already_linked_to_different_user");
    expect(await accountsOf(await currentUserId(bob))).toHaveLength(1);
  });
});

describe("解绑", () => {
  test("只剩一种登录方式时不能解绑；会话超过 10 分钟要求重新登录", async () => {
    const browser = new Browser(newApp());
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    const [only] = await accountsOf(userId);

    const last = await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: only?.id } });
    expect(last.status).toBe(400);
    expect(last.json.code).toBe("LAST_LOGIN_METHOD");

    const second = googleProfile();
    await signInWithGoogle(browser, second, { link: true, callbackURL: "/settings/account" });
    await ageSessions(userId, 11);
    const stale = await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: only?.id } });
    expect(stale.status).toBe(403);
    expect(stale.json.code).toBe("REAUTH_REQUIRED");

    // 用第二个 Google 重新登录一次，新会话是刚创建的。
    await signInWithGoogle(browser, second);
    const ok = await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: only?.id } });
    expect(ok.status).toBe(200);
    expect(await accountsOf(userId)).toHaveLength(1);
  });
});

describe("关掉的接口和来源校验", () => {
  test("自带的改资料、会话列表、邮箱密码等接口一律 404", async () => {
    const app = newApp();
    const cases = [
      ["POST", "/update-user"],
      ["GET", "/list-sessions"],
      ["POST", "/revoke-session"],
      ["POST", "/revoke-other-sessions"],
      ["POST", "/sign-in/email"],
      ["POST", "/sign-up/email"],
      ["POST", "/delete-user"],
      ["POST", "/change-email"],
    ] as const;
    for (const [method, path] of cases) {
      const res = await app.request(`/api/auth${path}`, {
        method,
        headers: { "content-type": "application/json", origin: TEST_PUBLIC_ORIGIN },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(res.status, path).toBe(404);
    }
  });

  test("带 Cookie 却不带 Origin 的 POST 被拒；callbackURL 指向外站也被拒", async () => {
    const browser = new Browser(newApp());
    await signInWithGoogle(browser, googleProfile());

    const noOrigin = await browser.request("POST", "/api/auth/sign-out", { body: {}, origin: null });
    expect(noOrigin.status).toBe(403);

    const evil = await browser.request("POST", "/api/auth/sign-in/social", {
      body: { provider: "google", callbackURL: "https://evil.example/steal" },
    });
    expect(evil.status).toBe(403);
  });
});

describe("限流", () => {
  // Better Auth 自带的规则：/sign-in* 同一 IP 10 秒 3 次。默认只在 NODE_ENV=production 时开，这里显式打开。
  test("打开时，同一 IP 10 秒内第 4 次发起 Google 登录返回 429", async () => {
    const browser = new Browser(newApp({ rateLimitEnabled: true }), { ip: "198.51.100.23" });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await browser.request("POST", "/api/auth/sign-in/social", { body: { provider: "google", callbackURL: "/" } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
