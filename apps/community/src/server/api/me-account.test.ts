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
import { TEST_PUBLIC_ORIGIN, TEST_USER_AGENT } from "../testing/constants";
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
    // 精确的键集合：不会多出 token、ipAddress 这样的字段。
    for (const item of res.json.sessions) {
      expect(Object.keys(item).sort()).toEqual(["browser", "country", "createdAt", "current", "id", "lastActiveAt", "os"]);
    }
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
    // 删掉的是旧会话，不是新会话：这个浏览器仍然是登录状态。
    expect(await currentUserId(browser)).toBe(userId);
  });

  // 请求头最长 16 KiB，而设备列表要用 Bowser 解析 User-Agent，它的兜底正则对超长的串是平方级的：存进库之前先截断。
  test("存进库的 User-Agent 最长 1024 个字符，短的原样存", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const userAgent = `Mozilla/5.0 ${"a".repeat(20_000)}`;
    const long = new Browser(app, { userAgent });
    const normal = new Browser(app);
    await signInWithGoogle(long, profile);
    await signInWithGoogle(normal, profile);

    const stored = (await sessionsOf(await currentUserId(long))).map((row) => row.userAgent ?? "");

    expect(stored).toHaveLength(2);
    expect(stored).toContain(TEST_USER_AGENT);
    const capped = stored.find((value) => value !== TEST_USER_AGENT);
    expect(capped).toHaveLength(1024);
    expect(capped).toBe(userAgent.slice(0, 1024));
  });

  // CF-IPCountry 是 Cloudflare 加的，但直连源站的请求可以自己随便带：存进库之前按登录设备列表的同一个
  // 规则检查，只存两位大写字母的国家代码。
  test("存进库的国家代码：JP 原样存，超长、小写、XX（判断不出）、T1（Tor）存成 null", async () => {
    const { app } = setup();
    const cases: [string, string | null][] = [
      ["JP", "JP"],
      ["J".repeat(300), null],
      ["jp", null],
      ["XX", null],
      ["T1", null],
    ];

    for (const [header, stored] of cases) {
      const browser = new Browser(app, { country: header });
      await signInWithGoogle(browser, googleProfile());
      const [row] = await sessionsOf(await currentUserId(browser));
      expect(row?.country ?? null, header.slice(0, 10)).toBe(stored);
    }
  });

  // 钩子存之前已经截断了；这条防的是库里已经存在的长行（钩子上线前登录的）。
  test("库里已有的超长 User-Agent 也只解析前 1024 个字符", async () => {
    const { app } = setup();
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile());
    // 能认出 Safari 的部分在 1024 个字符之后：整串解析认得出，只取前 1024 个字符就认不出。
    await testDbHandle()
      .db.insert(session)
      .values({
        token: `long-${crypto.randomUUID()}`,
        userId: await currentUserId(browser),
        expiresAt: new Date(Date.now() + 86_400_000),
        userAgent: `${"a".repeat(1100)} ${IPHONE_SAFARI}`,
      });

    const res = await browser.request("GET", "/api/v1/me/sessions");

    const other = res.json.sessions.find((item: { current: boolean }) => !item.current);
    expect(other).toMatchObject({ browser: null, os: null });
  });

  // 每个会话都要解析一次 User-Agent：一次请求最多列 50 个，限制总的解析量。超出的会话仍然能被"退出其他设备"清掉。
  test("设备列表最多 50 个会话：取最近活跃的，当前会话不会被更新的会话挤出去", async () => {
    const { app } = setup();
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    const currentId = (await sessionsOf(userId))[0]?.id ?? "";
    const now = Date.now();
    // 当前会话是最久没活跃的：另外 60 个都比它新（index 越大越旧）。
    await testDbHandle()
      .db.update(session)
      .set({ updatedAt: new Date(now - 3_600_000) })
      .where(eq(session.id, currentId));
    const inserted = await testDbHandle()
      .db.insert(session)
      .values(
        Array.from({ length: 60 }, (_, index) => ({
          token: `cap-${index}-${crypto.randomUUID()}`,
          userId,
          expiresAt: new Date(now + 86_400_000),
          updatedAt: new Date(now - index * 1000),
          userAgent: IPHONE_SAFARI,
        }))
      )
      .returning({ id: session.id, token: session.token });

    const res = await browser.request("GET", "/api/v1/me/sessions");

    const listed = res.json.sessions as { id: string; current: boolean; lastActiveAt: string }[];
    expect(listed).toHaveLength(50);
    expect(listed.filter((item) => item.current).map((item) => item.id)).toEqual([currentId]);
    // 其余 49 个是最近活跃的 49 个（index 0 到 48），最久没活跃的 11 个不在里面。
    const newest = inserted.filter((row) => Number(row.token.split("-")[1]) < 49).map((row) => row.id);
    expect(
      listed
        .filter((item) => !item.current)
        .map((item) => item.id)
        .sort()
    ).toEqual(newest.sort());
    // 显示的顺序仍然是最近活跃的在前。
    const activity = listed.map((item) => item.lastActiveAt);
    expect(activity).toEqual([...activity].sort().reverse());
  });

  // Bowser 认不出来的客户端（curl、okhttp……）返回空串，不能原样给出去：页面要的是 null。
  test("认不出来的客户端：浏览器和系统是 null，不是空串", async () => {
    const { app } = setup();
    const browser = new Browser(app, { userAgent: "curl/8.7.1" });
    await signInWithGoogle(browser, googleProfile());

    const res = await browser.request("GET", "/api/v1/me/sessions");

    expect(res.json.sessions).toHaveLength(1);
    expect(res.json.sessions[0]).toMatchObject({ browser: null, os: null });
  });

  // uuid 不分大小写：大写的 id 不能绕过"不能踢当前会话"的检查（否则等于用这个接口退出登录）。
  test("大写的会话 id 按小写处理：当前会话踢不掉，别的会话照常能踢", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const laptop = new Browser(app);
    const phone = new Browser(app);
    await signInWithGoogle(phone, profile);
    await signInWithGoogle(laptop, profile);
    const list = (await laptop.request("GET", "/api/v1/me/sessions")).json.sessions as { id: string; current: boolean }[];
    const currentId = list.find((item) => item.current)?.id ?? "";
    const otherId = list.find((item) => !item.current)?.id ?? "";

    const self = await laptop.request("DELETE", `/api/v1/me/sessions/${currentId.toUpperCase()}`, { headers: JSON_HEADERS });
    expect([self.status, self.json.error.code]).toEqual([400, "CURRENT_SESSION"]);
    expect((await laptop.request("GET", "/api/v1/me")).status).toBe(200);

    const other = await laptop.request("DELETE", `/api/v1/me/sessions/${otherId.toUpperCase()}`, { headers: JSON_HEADERS });
    expect(other.json).toEqual({ ok: true });
    expect((await phone.request("GET", "/api/v1/me")).status).toBe(401);
  });

  test("退出其他设备：已过期的会话照样清掉，但不计入返回的数量", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const phone = new Browser(app);
    const tablet = new Browser(app);
    const laptop = new Browser(app);
    for (const browser of [phone, tablet, laptop]) {
      await signInWithGoogle(browser, profile);
    }
    const userId = await currentUserId(laptop);
    const list = (await laptop.request("GET", "/api/v1/me/sessions")).json.sessions as { id: string; current: boolean }[];
    const currentId = list.find((item) => item.current)?.id ?? "";
    const expiredId = list.find((item) => !item.current)?.id ?? "";
    await testDbHandle()
      .db.update(session)
      .set({ expiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(session.id, expiredId));

    const res = await laptop.request("POST", "/api/v1/me/sessions/revoke-others", { body: {} });

    // 删掉了 2 行（一个还有效、一个已过期），只数没过期的那个。
    expect(res.json).toEqual({ revoked: 1 });
    expect((await sessionsOf(userId)).map((row) => row.id)).toEqual([currentId]);
  });

  test("退出其他设备也要求刚登录过；被拒时其他会话都还在", async () => {
    const { app } = setup();
    const profile = googleProfile();
    const phone = new Browser(app);
    const laptop = new Browser(app);
    await signInWithGoogle(phone, profile);
    await signInWithGoogle(laptop, profile);
    const userId = await currentUserId(laptop);

    await ageSessions(userId, 11);
    const res = await laptop.request("POST", "/api/v1/me/sessions/revoke-others", { body: {} });

    expect([res.status, res.json.error.code]).toEqual([403, "REAUTH_REQUIRED"]);
    expect(await sessionsOf(userId)).toHaveLength(2);
    expect((await phone.request("GET", "/api/v1/me")).status).toBe(200);
  });

  test("退出其他设备不影响别的用户", async () => {
    const { app } = setup();
    const aliceProfile = googleProfile();
    const aliceLaptop = new Browser(app);
    const alicePhone = new Browser(app);
    await signInWithGoogle(alicePhone, aliceProfile);
    await signInWithGoogle(aliceLaptop, aliceProfile);
    const bobProfile = googleProfile();
    const bobLaptop = new Browser(app);
    const bobPhone = new Browser(app);
    await signInWithGoogle(bobPhone, bobProfile);
    await signInWithGoogle(bobLaptop, bobProfile);
    const bobId = await currentUserId(bobLaptop);

    const res = await aliceLaptop.request("POST", "/api/v1/me/sessions/revoke-others", { body: {} });

    expect(res.json).toEqual({ revoked: 1 });
    expect((await alicePhone.request("GET", "/api/v1/me")).status).toBe(401);
    expect(await sessionsOf(bobId)).toHaveLength(2);
    expect((await bobLaptop.request("GET", "/api/v1/me")).status).toBe(200);
    expect((await bobPhone.request("GET", "/api/v1/me")).status).toBe(200);
  });
});
