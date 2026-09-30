import { beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { account, passkey, user } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import {
  createTestAuth,
  currentUserId,
  googleProfile,
  randomQq,
  signInWithGoogle,
  UNLIMITED,
  waitForCode,
} from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { SoftAuthenticator } from "../testing/soft-authenticator";
import { testSender } from "../testing/test-boss";
import { testDbHandle } from "../testing/test-db";

const RP_ID = new URL(TEST_PUBLIC_ORIGIN).hostname;
// TEST_PUBLIC_ORIGIN 是 https，所以 Cookie 名带 __Secure- 前缀。
const SESSION_COOKIE = "__Secure-adxc.session_token";
const JSON_HEADERS = { "content-type": "application/json" };

beforeAll(async () => {
  // 撤销注销要用 pg-boss 的发送端：testSender 先重建测试库，再建 pg-boss 的表和队列。
  await testSender();
}, 30_000);

function setup() {
  const { auth, outbox } = createTestAuth({ qqLimits: UNLIMITED });
  return { app: createApp(testAppDeps({ auth }).deps), outbox };
}

// 一个刚登录（满足"10 分钟内"）、有 Google 绑定和一个通行密钥、正在注销冷静期里的用户。
// 状态直接写库：拦截只看 user.status，和是怎么进入注销的无关。
async function pendingUser(app: ReturnType<typeof setup>["app"]) {
  const browser = new Browser(app);
  const profile = googleProfile();
  await signInWithGoogle(browser, profile);
  const userId = await currentUserId(browser);
  const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
  await browser.request("POST", "/api/auth/passkey/verify-registration", {
    body: { response: await new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID).createCredential(options.json) },
  });
  await testDbHandle().db.execute(
    sql`update "user" set status = 'pending_deletion', deletion_requested_at = now(), deletion_purge_at = now() + interval '7 days', deletion_delete_content = false where id = ${userId}`
  );
  const { db } = testDbHandle();
  const [google] = await db.select().from(account).where(eq(account.userId, userId));
  const [key] = await db.select().from(passkey).where(eq(passkey.userId, userId));
  return { browser, profile, userId, accountId: google?.id ?? "", passkeyId: key?.id ?? "" };
}

describe("待注销的用户调 /api/v1", () => {
  test("除了取当前用户、撤销注销和公开接口，一律 403 ACCOUNT_PENDING_DELETION", async () => {
    const { app } = setup();
    const { browser, userId } = await pendingUser(app);

    const blocked = [
      ["GET", "/api/v1/me/profile"],
      ["PATCH", "/api/v1/me/profile"],
      ["GET", "/api/v1/me/logins"],
      ["GET", "/api/v1/me/sessions"],
      ["POST", "/api/v1/me/sessions/revoke-others"],
      ["POST", "/api/v1/me/deletion"],
    ] as const;
    for (const [method, path] of blocked) {
      const res = await browser.request(method, path, { body: method === "GET" ? undefined : {} });
      expect([res.status, res.json?.error?.code], `${method} ${path}`).toEqual([403, "ACCOUNT_PENDING_DELETION"]);
    }

    for (const path of ["/api/v1/me", "/api/v1/meta", "/api/v1/login-options", `/api/v1/users/${userId}`]) {
      expect((await browser.request("GET", path)).status, path).toBe(200);
    }
    expect((await browser.request("GET", "/api/v1/me")).json).toMatchObject({ status: "pending_deletion" });
  });

  test("撤销注销之后，下一个请求就恢复正常", async () => {
    const { app } = setup();
    const { browser } = await pendingUser(app);

    const cancelled = await browser.request("DELETE", "/api/v1/me/deletion", { headers: JSON_HEADERS });
    const logins = await browser.request("GET", "/api/v1/me/logins");

    expect(cancelled.status).toBe(200);
    expect(logins.status).toBe(200);
  });

  test("正常用户不受影响", async () => {
    const { app } = setup();
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile());

    expect((await browser.request("GET", "/api/v1/me/logins")).status).toBe(200);
    expect((await browser.request("GET", "/api/v1/me/profile")).status).toBe(200);
  });
});

describe("待注销的用户改账号设置（Better Auth 的接口）", () => {
  test("绑定、解绑、添加 / 改名 / 删除通行密钥、绑定 QQ：一律 403 ACCOUNT_PENDING_DELETION，什么也没变", async () => {
    const { app, outbox } = setup();
    const { browser, userId, accountId, passkeyId } = await pendingUser(app);
    const qq = randomQq();
    await browser.request("POST", "/api/auth/qq/send-code", { body: { qq, turnstileToken: "pass" } });
    const code = await waitForCode(outbox, qq);

    const attempts: [string, () => ReturnType<Browser["request"]>][] = [
      ["link-social", () => browser.request("POST", "/api/auth/link-social", { body: { provider: "google", callbackURL: "/" } })],
      ["unlink-account", () => browser.request("POST", "/api/auth/unlink-account", { body: { accountId } })],
      ["generate-register-options", () => browser.request("GET", "/api/auth/passkey/generate-register-options")],
      ["verify-registration", () => browser.request("POST", "/api/auth/passkey/verify-registration", { body: { response: { id: "x" } } })],
      ["update-passkey", () => browser.request("POST", "/api/auth/passkey/update-passkey", { body: { id: passkeyId, name: "改名" } })],
      ["delete-passkey", () => browser.request("POST", "/api/auth/passkey/delete-passkey", { body: { id: passkeyId } })],
      ["qq/verify link", () => browser.request("POST", "/api/auth/qq/verify", { body: { qq, code, intent: "link" } })],
    ];
    for (const [name, attempt] of attempts) {
      const res = await attempt();
      expect([res.status, res.json?.code], name).toEqual([403, "ACCOUNT_PENDING_DELETION"]);
    }

    const { db } = testDbHandle();
    expect(await db.$count(account, eq(account.userId, userId))).toBe(1);
    const keys = await db.select().from(passkey).where(eq(passkey.userId, userId));
    expect(keys.map((key) => [key.id, key.name])).toEqual([[passkeyId, null]]);
  });

  test("Bearer 也一样", async () => {
    const { app } = setup();
    const { browser, accountId } = await pendingUser(app);
    const token = decodeURIComponent(browser.cookies.get(SESSION_COOKIE) ?? "");

    const res = await app.request("/api/auth/unlink-account", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("ACCOUNT_PENDING_DELETION");
  });

  // 待注销的用户要能登录，才能撤销注销（spec 第 10.6 节）。
  test("登录不拦：Google 重新登录照常，QQ 登录（intent=login）不被这条规则拦", async () => {
    const { app, outbox } = setup();
    const { browser, profile, userId } = await pendingUser(app);

    const google = await signInWithGoogle(new Browser(app), profile);
    const qq = randomQq();
    await browser.request("POST", "/api/auth/qq/send-code", { body: { qq, turnstileToken: "pass" } });
    const login = await browser.request("POST", "/api/auth/qq/verify", {
      body: { qq, code: await waitForCode(outbox, qq) },
    });

    expect(google.status).toBe(302);
    expect(google.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    // 新的 QQ 号会建一个新用户：这里只关心它没有被当成"改账号设置"拦下。
    expect(login.status).toBe(200);
    expect((await testDbHandle().db.select().from(user).where(eq(user.id, userId)))[0]?.status).toBe("pending_deletion");
  });

  test("没登录时只用通行密钥注册、正常用户绑定 Google：不受影响", async () => {
    const { app } = setup();
    const context = encodeURIComponent(JSON.stringify({ nickname: "新来的", turnstileToken: "pass" }));
    const signUp = await new Browser(app).request("GET", `/api/auth/passkey/generate-register-options?context=${context}`);
    const active = new Browser(app);
    await signInWithGoogle(active, googleProfile());
    const link = await active.request("POST", "/api/auth/link-social", {
      body: { provider: "google", callbackURL: "/settings/account" },
    });

    expect(signUp.status).toBe(200);
    expect(link.status).toBe(200);
  });
});
