import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { shortId } from "../../src/server/auth/short-id";
import { profiles, session, user } from "../../src/server/db/schema";
import { testDbHandle } from "../../src/server/testing/test-db";
import { HTTP_TEST_AUTH_SECRET, type RunningServer, startBuiltServer } from "./server";

// HTTP 测试走 http，会话 Cookie 不带 __Secure- 前缀。
const SESSION_COOKIE = "adxc.session_token";
const DAY_MS = 24 * 60 * 60 * 1000;

// 往测试库里直接放一个用户（可以是注销中的）和一个刚创建的会话，再用构建产物的密钥照 Better Auth 的方式签出
// 会话 Cookie。HTTP 测试走不通真的登录：Google、Turnstile 都要连外网。
async function seedUser(name: string, options: { pending?: boolean; bio?: string } = {}) {
  const { db } = testDbHandle();
  const id = shortId();
  await db.insert(user).values({
    id,
    name,
    email: `${id}@placeholder.invalid`,
    ...(options.pending
      ? {
          status: "pending_deletion" as const,
          deletionRequestedAt: new Date(),
          deletionPurgeAt: new Date(Date.now() + 7 * DAY_MS),
          deletionDeleteContent: false,
        }
      : {}),
  });
  if (options.bio !== undefined) {
    await db.insert(profiles).values({ userId: id, bio: options.bio });
  }
  const token = crypto.randomUUID().replaceAll("-", "");
  await db.insert(session).values({ token, userId: id, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
  const signed = `${token}.${await makeSignature(token, HTTP_TEST_AUTH_SECRET)}`;
  return { id, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

let server: RunningServer;

beforeAll(async () => {
  server = await startBuiltServer();
}, 60_000);

afterAll(() => {
  server.stop();
});

describe("个人主页", () => {
  test("允许收录：标题、描述是昵称和简介，显示用户 ID；不缓存", async () => {
    const { id } = await seedUser("主页测试", { bio: "写谱的\n也打歌" });

    const res = await fetch(server.url(`/u/${id}`));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain(`<link rel="canonical" href="${server.origin}/u/${id}"/>`);
    expect(html).toContain(`<link rel="alternate" hrefLang="en" href="${server.origin}/en/u/${id}"/>`);
    expect(html).toContain(`<link rel="alternate" hrefLang="x-default" href="${server.origin}/u/${id}"/>`);
    expect(html).toContain("<title>主页测试 - AstroDX 自制谱社区</title>");
    expect(html).toContain('<meta name="description" content="写谱的 也打歌"/>');
    expect(html).toContain(`ID：${id}`);
    expect(html).not.toContain("noindex");
  });

  test("正在注销：显示'该用户正在注销'，不收录，也不出现昵称", async () => {
    const { id } = await seedUser("要走的人", { pending: true });

    const res = await fetch(server.url(`/u/${id}`));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("该用户正在注销");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain("要走的人");
  });

  test("不存在的 id、格式不对的 id：404 页", async () => {
    for (const id of [shortId(), "NOT-AN-ID"]) {
      const res = await fetch(server.url(`/u/${id}`));
      expect(res.status, id).toBe(404);
      expect(res.headers.get("cache-control"), id).toBe("private, no-store");
      expect(await res.text(), id).toContain("页面不存在");
    }
  });
});

describe("需要登录的新页面", () => {
  test("未登录访问个人资料、引导页、注销提示页：跳到登录页并带上原地址", async () => {
    for (const path of ["/settings/profile", "/onboarding?next=%2F", "/account-deletion"]) {
      const res = await fetch(server.url(path), { redirect: "manual" });
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
  });

  test("已登录：个人资料页和引导页正常显示，不收录", async () => {
    const { cookie } = await seedUser("资料测试");

    for (const path of ["/settings/profile", "/onboarding"]) {
      const res = await fetch(server.url(path), { headers: { cookie }, redirect: "manual" });
      const html = await res.text();
      expect(res.status, path).toBe(200);
      expect(html, path).toContain('value="资料测试"');
      expect(html, path).toContain('<meta name="robots" content="noindex"/>');
    }
  });
});

describe("注销冷静期里的用户", () => {
  test("别的页面一律跳到注销提示页（保留语言前缀）；注销提示页本身正常显示", async () => {
    const { cookie } = await seedUser("冷静期", { pending: true });

    for (const [path, location] of [
      ["/", "/account-deletion"],
      ["/settings/account", "/account-deletion"],
      ["/login", "/account-deletion"],
      ["/en/settings/profile", "/en/account-deletion"],
    ] as const) {
      const res = await fetch(server.url(path), { headers: { cookie }, redirect: "manual" });
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe(location);
    }
    const page = await fetch(server.url("/account-deletion"), { headers: { cookie } });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("账号注销中");
    expect(html).toContain("撤销注销");
  });

  test("接口：白名单里的（取当前用户）可以，白名单之外一律 403 ACCOUNT_PENDING_DELETION", async () => {
    const { cookie } = await seedUser("冷静期", { pending: true });

    const me = await fetch(server.url("/api/v1/me"), { headers: { cookie } });
    const logins = await fetch(server.url("/api/v1/me/logins"), { headers: { cookie } });

    expect(me.status).toBe(200);
    expect(((await me.json()) as { status: string }).status).toBe("pending_deletion");
    expect(logins.status).toBe(403);
    expect(await logins.json()).toEqual({
      error: { code: "ACCOUNT_PENDING_DELETION", message: "This account is scheduled for deletion" },
    });
  });

  test("正常用户打开注销提示页：回首页", async () => {
    const { cookie } = await seedUser("正常用户");

    const res = await fetch(server.url("/account-deletion"), { headers: { cookie }, redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});

// 没有请求体的 DELETE。开发服务器里它们曾被请求体上限换成 GET，撤销注销和踢下线都不灵（middleware/body-limit.ts）；
// 构建产物用 Bun.serve，请求体本来就是空的，不受影响，这里留作回归。
describe("没有请求体的 DELETE", () => {
  const jsonHeaders = (cookie: string) => ({ cookie, origin: server.origin, "content-type": "application/json" });

  test("撤销注销：200，账号恢复正常", async () => {
    const { id, cookie } = await seedUser("撤销注销", { pending: true });

    const res = await fetch(server.url("/api/v1/me/deletion"), { method: "DELETE", headers: jsonHeaders(cookie) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "active" });
    const [row] = await testDbHandle()
      .db.select({ status: user.status, purgeAt: user.deletionPurgeAt })
      .from(user)
      .where(eq(user.id, id));
    expect(row).toEqual({ status: "active", purgeAt: null });
  });

  test("踢下线：200，指定的会话被删掉", async () => {
    const { id, cookie } = await seedUser("踢下线");
    const { db } = testDbHandle();
    const otherSessionId = crypto.randomUUID();
    await db.insert(session).values({
      id: otherSessionId,
      token: crypto.randomUUID().replaceAll("-", ""),
      userId: id,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });

    const res = await fetch(server.url(`/api/v1/me/sessions/${otherSessionId}`), {
      method: "DELETE",
      headers: jsonHeaders(cookie),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await db.select({ id: session.id }).from(session).where(eq(session.id, otherSessionId))).toEqual([]);
  });
});
