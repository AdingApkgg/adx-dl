import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { createApp } from "../app";
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
