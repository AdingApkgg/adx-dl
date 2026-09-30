import { beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { session, user } from "../db/schema";
import { USER_PURGE_QUEUE } from "../jobs/queues";
import type { DeletionHandler } from "../services/user-deletion";
import { testAppDeps } from "../testing/app-deps";
import { ageSessions, createTestAuth, currentUserId, type GoogleProfile, googleProfile, signInWithGoogle } from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { waitUntilDue } from "../testing/deletion";
import { testSender } from "../testing/test-boss";
import { testDbHandle } from "../testing/test-db";

// TEST_PUBLIC_ORIGIN 是 https，所以 Cookie 名带 __Secure- 前缀。
const SESSION_COOKIE = "__Secure-adxc.session_token";
// /api/v1 改数据的接口只收 JSON（CSRF 规则）：没有请求体的 DELETE 也要带这个头。
const JSON_HEADERS = { "content-type": "application/json" };
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  // testSender 先重建测试库，再建 pg-boss 的表和队列（注销要投递 user.purge）。
  await testSender();
}, 30_000);

// 有内容的账号：假装某个模块里有这个用户的内容，注销要走 7 天冷静期。
const withContent: DeletionHandler = { name: "fake-content", hasContent: async () => true, purge: async () => {} };

function newApp(handlers: readonly DeletionHandler[] = []) {
  const { deps } = testAppDeps({ auth: createTestAuth().auth });
  return createApp({ ...deps, services: { ...deps.services, deletionHandlers: handlers } });
}

async function signedIn(app: ReturnType<typeof createApp>, profile: GoogleProfile = googleProfile()) {
  const browser = new Browser(app);
  await signInWithGoogle(browser, profile);
  return { browser, profile, userId: await currentUserId(browser) };
}

function requestDeletion(browser: Browser, body: unknown) {
  return browser.request("POST", "/api/v1/me/deletion", { body });
}

async function userRow(id: string) {
  const [row] = await testDbHandle().db.select().from(user).where(eq(user.id, id));
  return row;
}

describe("POST /api/v1/me/deletion", () => {
  test("未登录返回 401", async () => {
    const browser = new Browser(newApp());

    const res = await requestDeletion(browser, { deleteContent: false, confirmId: "abc2345678" });

    expect(res.status).toBe(401);
  });

  test("会话超过 10 分钟：403 REAUTH_REQUIRED，账号不变", async () => {
    const { browser, userId } = await signedIn(newApp());
    await ageSessions(userId, 11);

    const res = await requestDeletion(browser, { deleteContent: false, confirmId: userId });

    expect([res.status, res.json.error.code]).toEqual([403, "REAUTH_REQUIRED"]);
    expect((await userRow(userId))?.status).toBe("active");
  });

  test("输入的 id 不是自己的（别人的、大小写不对）：400 DELETION_CONFIRM_MISMATCH，账号不变", async () => {
    const app = newApp();
    const { browser, userId } = await signedIn(app);
    const other = await signedIn(app);

    for (const confirmId of [other.userId, userId.toUpperCase(), ""]) {
      const res = await requestDeletion(browser, { deleteContent: false, confirmId });
      expect([res.status, res.json.error.code], confirmId).toEqual([400, "DELETION_CONFIRM_MISMATCH"]);
    }
    expect((await userRow(userId))?.status).toBe("active");
  });

  test("请求体不对：400 BAD_REQUEST", async () => {
    const { browser, userId } = await signedIn(newApp());

    for (const body of [{ confirmId: userId }, { deleteContent: "yes", confirmId: userId }, { deleteContent: false }]) {
      const res = await requestDeletion(browser, body);
      expect([res.status, res.json.error.code], JSON.stringify(body)).toEqual([400, "BAD_REQUEST"]);
    }
  });

  test("空账号：200，清除时间是现在；会话 Cookie 被清掉，所有会话失效；投递了清除任务", async () => {
    const { browser, userId } = await signedIn(newApp());
    const before = Date.now();

    const res = await requestDeletion(browser, { deleteContent: false, confirmId: userId });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ purgeAt: expect.any(String), signedOut: true });
    const purgeAt = new Date(res.json.purgeAt).getTime();
    expect(purgeAt).toBeGreaterThanOrEqual(before);
    expect(purgeAt).toBeLessThanOrEqual(Date.now());
    const cleared = res.headers.getSetCookie().filter((line) => line.startsWith(`${SESSION_COOKIE}=`));
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatch(/Max-Age=0/i);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    expect((await userRow(userId))?.status).toBe("pending_deletion");
    expect(await testDbHandle().db.$count(session, eq(session.userId, userId))).toBe(0);
    expect((await browser.request("GET", "/api/v1/me")).status).toBe(401);
    const jobs = await (await testSender()).findJobs(USER_PURGE_QUEUE, { key: userId });
    expect(jobs.map((job) => job.state)).toEqual(["created"]);
  });

  test("同一个用户的其他设备也被退出", async () => {
    const app = newApp();
    const profile = googleProfile();
    const laptop = await signedIn(app, profile);
    const phone = await signedIn(app, profile);

    await requestDeletion(laptop.browser, { deleteContent: false, confirmId: laptop.userId });

    expect((await phone.browser.request("GET", "/api/v1/me")).status).toBe(401);
  });

  // 这次请求的会话恰好满一天要续期：续期的 Set-Cookie 不能排在清除头后面把 Cookie 又设回去。
  test("会话到了续期时间：响应里的会话 Cookie 只有一条清除头，没有续期头", async () => {
    const { browser, userId } = await signedIn(newApp());
    await testDbHandle().db.execute(
      sql`update session set updated_at = now() - interval '2 days', expires_at = now() + interval '28 days' where user_id = ${userId}`
    );

    const res = await requestDeletion(browser, { deleteContent: false, confirmId: userId });

    const lines = res.headers.getSetCookie().filter((line) => line.startsWith(`${SESSION_COOKIE}=`));
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Max-Age=0/i);
  });

  test("有内容的账号：清除时间是 7 天后；重新登录后 /api/v1/me 显示注销中和清除时间", async () => {
    const app = newApp([withContent]);
    const { browser, profile, userId } = await signedIn(app);
    const before = Date.now();

    const res = await requestDeletion(browser, { deleteContent: true, confirmId: userId });
    await signInWithGoogle(browser, profile);
    const me = await browser.request("GET", "/api/v1/me");

    const purgeAt = new Date(res.json.purgeAt).getTime();
    expect(purgeAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(purgeAt).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(me.json).toMatchObject({ id: userId, status: "pending_deletion", deletionPurgeAt: res.json.purgeAt });
    expect((await userRow(userId))?.deletionDeleteContent).toBe(true);
  });

  // App 用 Bearer 调：没有 Cookie 可清，响应里的 signedOut 告诉它丢掉令牌；令牌确实已经不能用了。
  test("Bearer：注销成功，令牌随即失效", async () => {
    const app = newApp();
    const { browser, userId } = await signedIn(app);
    const authorization = `Bearer ${decodeURIComponent(browser.cookies.get(SESSION_COOKIE) ?? "")}`;

    const res = await app.request("/api/v1/me/deletion", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ deleteContent: false, confirmId: userId }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { signedOut: boolean }).signedOut).toBe(true);
    expect((await app.request("/api/v1/me", { headers: { authorization } })).status).toBe(401);
  });

  // 注销已经提交，只有事后让 Better Auth 发清除头的那一步出了错：响应照常 200，错误要记进日志，不能悄悄吞掉。
  test("发清除头的 signOut 出错：仍然 200，账号在注销中、没有会话，错误记进日志", async () => {
    const { auth } = createTestAuth();
    const { deps, logs } = testAppDeps({ auth });
    const { browser, userId } = await signedIn(createApp(deps));
    // 在对象上换掉方法（不用 mock.module：它会泄漏到同一进程里的其他测试文件）。auth.api 的成员在类型上是
    // 只读的、运行时可写：通过一个可写的视图来换。抛普通的 Error：Better Auth 自己的错误会往控制台打东西。
    const api: { signOut: unknown } = auth.api;
    const signOut = api.signOut;
    api.signOut = async () => {
      throw new Error("sign-out failed on purpose");
    };
    try {
      const res = await requestDeletion(browser, { deleteContent: false, confirmId: userId });

      expect(res.status).toBe(200);
      expect(res.json).toEqual({ purgeAt: expect.any(String), signedOut: true });
      expect((await userRow(userId))?.status).toBe("pending_deletion");
      expect(await testDbHandle().db.$count(session, eq(session.userId, userId))).toBe(0);
      const failures = logs().filter((entry) => entry.event === "deletion_sign_out_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ level: "error", userId, name: "Error", message: "sign-out failed on purpose" });
    } finally {
      api.signOut = signOut;
    }
  });
});

describe("DELETE /api/v1/me/deletion", () => {
  test("冷静期内撤销：恢复正常，清除任务被取消", async () => {
    const app = newApp([withContent]);
    const { browser, profile, userId } = await signedIn(app);
    await requestDeletion(browser, { deleteContent: false, confirmId: userId });
    await signInWithGoogle(browser, profile);

    const res = await browser.request("DELETE", "/api/v1/me/deletion", { headers: JSON_HEADERS });

    expect([res.status, res.json]).toEqual([200, { status: "active" }]);
    expect((await browser.request("GET", "/api/v1/me")).json).toMatchObject({ status: "active", deletionPurgeAt: null });
    const jobs = await (await testSender()).findJobs(USER_PURGE_QUEUE, { key: userId });
    expect(jobs.map((job) => job.state)).toEqual(["cancelled"]);
  });

  // 空账号一申请就到了清除时间：worker 还没来得及清除时重新登录，也撤销不了。
  test("到了清除时间：409 DELETION_NOT_CANCELLABLE，还是注销中", async () => {
    const app = newApp();
    const { browser, profile, userId } = await signedIn(app);
    await requestDeletion(browser, { deleteContent: false, confirmId: userId });
    await waitUntilDue(userId);
    await signInWithGoogle(browser, profile);

    const res = await browser.request("DELETE", "/api/v1/me/deletion", { headers: JSON_HEADERS });

    expect([res.status, res.json.error.code]).toEqual([409, "DELETION_NOT_CANCELLABLE"]);
    expect((await userRow(userId))?.status).toBe("pending_deletion");
  });

  test("没在注销：409 DELETION_NOT_CANCELLABLE；未登录 401", async () => {
    const { browser } = await signedIn(newApp());

    const res = await browser.request("DELETE", "/api/v1/me/deletion", { headers: JSON_HEADERS });
    const anonymous = await new Browser(newApp()).request("DELETE", "/api/v1/me/deletion", { headers: JSON_HEADERS });

    expect([res.status, res.json.error.code]).toEqual([409, "DELETION_NOT_CANCELLABLE"]);
    expect(anonymous.status).toBe(401);
  });
});
