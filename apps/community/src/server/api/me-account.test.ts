import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { session } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import {
  ageSessions,
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
import { resetTestDatabase, testDbHandle } from "../testing/test-db";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// /api/v1 改数据的接口只收 JSON（CSRF 规则），没有请求体的 DELETE 也要带这个头，和页面里发请求的做法一致。
// Browser 只在有请求体时才补 content-type，不带的话请求过不了 csrfGuard（415）。
const JSON_HEADERS = { "content-type": "application/json" };

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

function setup(options?: Parameters<typeof createTestAuth>[0]) {
  const { auth, outbox } = createTestAuth(options);
  return { app: createApp(testAppDeps({ auth }).deps), outbox };
}

function sessionsOf(userId: string) {
  return testDbHandle().db.select().from(session).where(eq(session.userId, userId));
}

describe("GET /api/v1/me/logins", () => {
  test("Google 显示邮箱，QQ 显示昵称和打码的号码，通行密钥显示名称和时间", async () => {
    const qq = randomQq();
    const { app, outbox } = setup({ nicknames: { [qq]: "小马哥" }, qqLimits: UNLIMITED });
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile({ email: "alice@gmail.com" }));
    await browser.request("POST", "/api/auth/qq/send-code", { body: { qq, turnstileToken: "pass" } });
    await browser.request("POST", "/api/auth/qq/verify", {
      body: { qq, code: await waitForCode(outbox, qq), intent: "link" },
    });
    const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
    await browser.request("POST", "/api/auth/passkey/verify-registration", {
      body: { response: await new SoftAuthenticator(TEST_PUBLIC_ORIGIN, "community.test").createCredential(options.json) },
    });

    const res = await browser.request("GET", "/api/v1/me/logins");

    expect(res.status).toBe(200);
    expect(res.json.accounts).toEqual([
      { id: expect.any(String), provider: "google", email: "alice@gmail.com", createdAt: expect.any(String) },
      {
        id: expect.any(String),
        provider: "qq",
        nickname: "小马哥",
        maskedQq: `${qq.slice(0, 2)}****${qq.slice(-2)}`,
        createdAt: expect.any(String),
      },
    ]);
    expect(res.json.passkeys).toEqual([
      { id: expect.any(String), name: null, createdAt: expect.any(String), lastUsedAt: null },
    ]);
  });

  test("未登录返回 401", async () => {
    expect((await setup().app.request("/api/v1/me/logins")).status).toBe(401);
  });
});

describe("登录设备", () => {
  test("列出本人的有效会话：标出当前会话，解析浏览器、系统和国家", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const laptop = new Browser(app);
    const phone = new Browser(app, { userAgent: IPHONE_SAFARI, country: "XX" });
    await signInWithGoogle(laptop, profile);
    await signInWithGoogle(phone, profile);

    const res = await laptop.request("GET", "/api/v1/me/sessions");

    expect(res.status).toBe(200);
    expect(res.json.sessions).toHaveLength(2);
    const current = res.json.sessions.find((item: { current: boolean }) => item.current);
    const other = res.json.sessions.find((item: { current: boolean }) => !item.current);
    expect(current).toMatchObject({ browser: "Chrome", os: "Windows", country: "JP" });
    // CF-IPCountry 是 XX（判断不出）时当作没有。
    expect(other).toMatchObject({ browser: "Safari", os: "iOS", country: null });
    expect(other).toHaveProperty("lastActiveAt");
  });

  test("踢下线：要求刚登录过；不能踢当前会话；踢掉后那台设备就掉线；不存在或不合法的 id 返回 404", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const laptop = new Browser(app);
    const phone = new Browser(app);
    await signInWithGoogle(laptop, profile);
    await signInWithGoogle(phone, profile);
    const userId = await currentUserId(laptop);
    const list = (await laptop.request("GET", "/api/v1/me/sessions")).json.sessions as { id: string; current: boolean }[];
    const currentId = list.find((item) => item.current)?.id;
    const otherId = list.find((item) => !item.current)?.id;

    await ageSessions(userId, 11);
    const stale = await laptop.request("DELETE", `/api/v1/me/sessions/${otherId}`, { headers: JSON_HEADERS });
    expect([stale.status, stale.json.error.code]).toEqual([403, "REAUTH_REQUIRED"]);

    await signInWithGoogle(laptop, profile);
    const fresh = (await laptop.request("GET", "/api/v1/me/sessions")).json.sessions as { id: string; current: boolean }[];
    const freshCurrentId = fresh.find((item) => item.current)?.id;
    expect(freshCurrentId).not.toBe(currentId);

    const self = await laptop.request("DELETE", `/api/v1/me/sessions/${freshCurrentId}`, { headers: JSON_HEADERS });
    expect([self.status, self.json.error.code]).toEqual([400, "CURRENT_SESSION"]);
    expect((await laptop.request("DELETE", "/api/v1/me/sessions/not-a-uuid", { headers: JSON_HEADERS })).status).toBe(404);
    expect(
      (await laptop.request("DELETE", `/api/v1/me/sessions/${crypto.randomUUID()}`, { headers: JSON_HEADERS })).status
    ).toBe(404);

    expect(
      (await laptop.request("DELETE", `/api/v1/me/sessions/${otherId}`, { headers: JSON_HEADERS })).json
    ).toEqual({ ok: true });
    expect((await phone.request("GET", "/api/v1/me")).status).toBe(401);
  });

  test("别人的会话踢不了", async () => {
    const { app } = setup();
    const alice = new Browser(app);
    const mallory = new Browser(app);
    await signInWithGoogle(alice, googleProfile());
    await signInWithGoogle(mallory, googleProfile());
    const [alicesSession] = await sessionsOf(await currentUserId(alice));

    const res = await mallory.request("DELETE", `/api/v1/me/sessions/${alicesSession?.id}`, { headers: JSON_HEADERS });

    expect(res.status).toBe(404);
    expect((await alice.request("GET", "/api/v1/me")).status).toBe(200);
  });

  test("退出其他所有设备", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const laptop = new Browser(app);
    const phone = new Browser(app);
    const tablet = new Browser(app);
    for (const browser of [phone, tablet, laptop]) {
      await signInWithGoogle(browser, profile);
    }

    const res = await laptop.request("POST", "/api/v1/me/sessions/revoke-others", { body: {} });

    expect(res.json).toEqual({ revoked: 2 });
    expect((await phone.request("GET", "/api/v1/me")).status).toBe(401);
    expect((await tablet.request("GET", "/api/v1/me")).status).toBe(401);
    expect((await laptop.request("GET", "/api/v1/me")).status).toBe(200);
  });

  // 为了满足"10 分钟内刚登录"再登录一次时，旧会话反正会被新 Cookie 覆盖，不该留在列表里。
  test("同一个浏览器重新登录时，原来的会话被删掉", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const browser = new Browser(app);
    await signInWithGoogle(browser, profile);
    const userId = await currentUserId(browser);

    await signInWithGoogle(browser, profile);

    expect(await sessionsOf(userId)).toHaveLength(1);
  });
});
