import { beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { session } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import { createTestAuth, currentUserId, googleProfile, signInWithGoogle } from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

function newApp() {
  return createApp(testAppDeps({ auth: createTestAuth().auth }).deps);
}

describe("GET /api/v1/me", () => {
  test("未登录返回 401", async () => {
    const res = await newApp().request("/api/v1/me");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
  });

  test("登录后返回当前用户", async () => {
    const browser = new Browser(newApp());
    await signInWithGoogle(browser, googleProfile({ name: "阿丁" }));

    const res = await browser.request("GET", "/api/v1/me");

    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      id: await currentUserId(browser),
      name: "阿丁",
      image: null,
      status: "active",
      createdAt: expect.any(String),
      deletionPurgeAt: null,
    });
  });

  // 数据库里的过期时间已经延长，浏览器的 Cookie 也要跟着延长，否则到期还是会掉线。
  test("会话满一天时续期，新的会话 Cookie 带回浏览器", async () => {
    const browser = new Browser(newApp());
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    await testDbHandle().db.execute(
      sql`update session set updated_at = now() - interval '2 days', expires_at = now() + interval '28 days' where user_id = ${userId}`
    );

    const res = await browser.request("GET", "/api/v1/me");

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith("__Secure-adxc.session_token="))).toBe(true);
  });

  // 同一个浏览器重新登录时旧会话会被删掉。还带着旧 Cookie、晚到的请求（另一个标签页、聚焦时的自动刷新）
  // 如果收到"清掉 Cookie"的 Set-Cookie，会把刚登录的新 Cookie 也清掉。
  test("Cookie 指向的会话已经不在时，响应里没有任何 Set-Cookie", async () => {
    const app = newApp();
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    // 直接用 app.request 带着同一个 Cookie 发：Browser 收到清掉 Cookie 的响应后会把它扔掉，第二个请求就不带了。
    const cookie = browser.cookieHeader();
    await testDbHandle().db.delete(session).where(eq(session.userId, userId));

    const options = await app.request("/api/v1/login-options", { headers: { cookie } });
    const me = await app.request("/api/v1/me", { headers: { cookie } });

    expect(options.status).toBe(200);
    expect(options.headers.getSetCookie()).toEqual([]);
    expect(me.status).toBe(401);
    expect(me.headers.getSetCookie()).toEqual([]);
  });

  // 会话满一天、这次请求要续期，而会话恰好在读出来之后被删掉（另一个标签页踢下线、同一个浏览器重新登录、注销）：
  // Better Auth 续期失败时抛 401。当作没登录，不能变成 500；它顺带发的"清掉 Cookie"也不转发。
  test("续期时会话被并发删掉：401 而不是 500，没有 Set-Cookie", async () => {
    const { auth } = createTestAuth();
    const app = createApp(testAppDeps({ auth }).deps);
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    await testDbHandle().db.execute(
      sql`update session set updated_at = now() - interval '2 days', expires_at = now() + interval '28 days' where user_id = ${userId}`
    );
    // 在对象上换掉方法（不用 mock.module：它会泄漏到同一进程里的其他测试文件），读出会话后立刻把它删掉。
    const { internalAdapter } = await auth.$context;
    const findSession = internalAdapter.findSession;
    internalAdapter.findSession = async (token) => {
      const found = await findSession(token);
      await testDbHandle().db.delete(session).where(eq(session.token, token));
      return found;
    };
    try {
      const res = await browser.request("GET", "/api/v1/me");

      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
    } finally {
      internalAdapter.findSession = findSession;
    }
  });

  // sessionContext 只接住 401：数据库出错这类照旧往外抛，不能因为数据库抖一下就把所有人当成没登录。
  test("读会话时数据库出错：500 INTERNAL，记下 unhandled_error，不当成没登录", async () => {
    const { auth } = createTestAuth();
    const { deps, logs } = testAppDeps({ auth });
    const browser = new Browser(createApp(deps));
    await signInWithGoogle(browser, googleProfile());
    // 在对象上换掉方法，理由同上。
    const { internalAdapter } = await auth.$context;
    const findSession = internalAdapter.findSession;
    internalAdapter.findSession = async () => {
      throw new Error("db down");
    };
    try {
      const res = await browser.request("GET", "/api/v1/me");

      expect([res.status, res.json?.error?.code]).toEqual([500, "INTERNAL"]);
      expect(logs().filter((entry) => entry.event === "unhandled_error")).toEqual([
        expect.objectContaining({ level: "error", method: "GET", path: "/api/v1/me" }),
      ]);
    } finally {
      internalAdapter.findSession = findSession;
    }
  });
});

describe("按用户限流", () => {
  // 1b 还没有 /api/v1 的写接口：对一个不存在的 POST 地址发请求，限流中间件照样计数（它在路由之前）。
  // 61 次请求每次都要经 sessionContext 查一次会话；测试库在隧道另一端，超时给宽一点（本机直连的
  // Postgres 不会这么慢，默认的 5s 是给本地数据库设的）。
  test(
    "改数据的请求同一用户每分钟 60 次，第 61 次返回 429",
    async () => {
      const browser = new Browser(newApp());
      await signInWithGoogle(browser, googleProfile());

      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) {
        statuses.push((await browser.request("POST", "/api/v1/meta", { body: {} })).status);
      }

      expect(statuses.slice(0, 60).every((status) => status === 404)).toBe(true);
      expect(statuses[60]).toBe(429);
    },
    60_000
  );
});
