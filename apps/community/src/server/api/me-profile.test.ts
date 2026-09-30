import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { profiles, user } from "../db/schema";
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

async function signedIn(name = "阿丁") {
  const browser = new Browser(newApp());
  await signInWithGoogle(browser, googleProfile({ name }));
  return { browser, userId: await currentUserId(browser) };
}

function profileRow(userId: string) {
  return testDbHandle().db.select().from(profiles).where(eq(profiles.userId, userId));
}

describe("GET /api/v1/me/profile", () => {
  test("未登录返回 401", async () => {
    const res = await newApp().request("/api/v1/me/profile");

    expect(res.status).toBe(401);
  });

  // profiles 行按需创建：新用户还没有这一行，按默认值返回。
  test("新用户：昵称来自 user 表，简介为空，没看过引导页；这时还没有 profiles 行", async () => {
    const { browser, userId } = await signedIn("阿丁");

    const res = await browser.request("GET", "/api/v1/me/profile");

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ name: "阿丁", bio: "", onboardedAt: null });
    expect(await profileRow(userId)).toEqual([]);
  });
});

describe("PATCH /api/v1/me/profile", () => {
  test("未登录返回 401，不管请求体对不对", async () => {
    const browser = new Browser(newApp());

    const res = await browser.request("PATCH", "/api/v1/me/profile", { body: { name: 123 } });

    expect(res.status).toBe(401);
  });

  test("改昵称和简介：规整后存下，返回新的资料；/api/v1/me 立刻是新昵称", async () => {
    const { browser, userId } = await signedIn();

    const res = await browser.request("PATCH", "/api/v1/me/profile", {
      body: { name: "  新昵称\u0007 ", bio: "  第一行\r\n第二行  " },
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ name: "新昵称", bio: "第一行\n第二行", onboardedAt: null });
    expect((await browser.request("GET", "/api/v1/me")).json.name).toBe("新昵称");
    const [row] = await profileRow(userId);
    expect(row?.bio).toBe("第一行\n第二行");
  });

  test("只改简介时昵称不动；只改昵称时简介不动", async () => {
    const { browser } = await signedIn("原来的昵称");

    await browser.request("PATCH", "/api/v1/me/profile", { body: { bio: "简介" } });
    const res = await browser.request("PATCH", "/api/v1/me/profile", { body: { name: "改过的昵称" } });

    expect(res.json).toEqual({ name: "改过的昵称", bio: "简介", onboardedAt: null });
  });

  test("昵称空白、超过 24 个字符：400 NICKNAME_INVALID，什么也没改", async () => {
    const { browser, userId } = await signedIn("阿丁");

    for (const name of ["   ", "😀".repeat(25), "\u202E"]) {
      const res = await browser.request("PATCH", "/api/v1/me/profile", { body: { name, bio: "不该存下" } });
      expect([res.status, res.json.error.code], name).toEqual([400, "NICKNAME_INVALID"]);
    }
    const [row] = await testDbHandle().db.select().from(user).where(eq(user.id, userId));
    expect(row?.name).toBe("阿丁");
    expect(await profileRow(userId)).toEqual([]);
  });

  test("简介超过 300 个字符：400 BIO_TOO_LONG；正好 300 个表情可以", async () => {
    const { browser } = await signedIn();

    const tooLong = await browser.request("PATCH", "/api/v1/me/profile", { body: { bio: "😀".repeat(301) } });
    const exact = await browser.request("PATCH", "/api/v1/me/profile", { body: { bio: "😀".repeat(300) } });

    expect([tooLong.status, tooLong.json.error.code]).toEqual([400, "BIO_TOO_LONG"]);
    expect(exact.status).toBe(200);
    expect(exact.json.bio).toBe("😀".repeat(300));
  });

  // 长度规则只在 parseNickname、parseBio 里：请求体的 zod 形状不设长度上限。过去 zod 的上限（昵称 1000、简介 10000）
  // 会让更长的值得到 BAD_REQUEST，前端就分不出是哪一项超了。
  test("昵称超过 1000 个字符、简介超过 10000 个字符：照样是各自的错误码，什么也没改", async () => {
    const { browser, userId } = await signedIn("阿丁");

    const longName = await browser.request("PATCH", "/api/v1/me/profile", { body: { name: "a".repeat(1001) } });
    const longBio = await browser.request("PATCH", "/api/v1/me/profile", { body: { bio: "a".repeat(10_001) } });

    expect([longName.status, longName.json.error.code]).toEqual([400, "NICKNAME_INVALID"]);
    expect([longBio.status, longBio.json.error.code]).toEqual([400, "BIO_TOO_LONG"]);
    const [row] = await testDbHandle().db.select().from(user).where(eq(user.id, userId));
    expect(row?.name).toBe("阿丁");
    expect(await profileRow(userId)).toEqual([]);
  });

  test("字段类型不对、onboarded 不是 true：400 BAD_REQUEST", async () => {
    const { browser } = await signedIn();

    for (const body of [{ name: 123 }, { bio: null }, { onboarded: false }]) {
      const res = await browser.request("PATCH", "/api/v1/me/profile", { body });
      expect([res.status, res.json.error.code], JSON.stringify(body)).toEqual([400, "BAD_REQUEST"]);
    }
  });

  test("onboarded: true 记下引导页看过的时间；再记一次时间不变", async () => {
    const { browser } = await signedIn();

    const first = await browser.request("PATCH", "/api/v1/me/profile", { body: { onboarded: true } });
    const second = await browser.request("PATCH", "/api/v1/me/profile", { body: { onboarded: true, bio: "后来写的" } });

    expect(first.json.onboardedAt).toEqual(expect.any(String));
    expect(second.json).toMatchObject({ onboardedAt: first.json.onboardedAt, bio: "后来写的" });
  });
});

describe("请求体上限", () => {
  // /api/v1/* 的请求体上限是 64 KiB（app.ts）。JSON 校验器会先把整个请求体读进内存、解析完，才轮到字段自己的规则，
  // 所以请求的大小只能在这里限。上限只管声明了请求体的请求（middleware/body-limit.ts）：真实的 HTTP/1.1 请求有请求体，
  // 就一定带 Content-Length 或 Transfer-Encoding。带 Content-Length 的直接比大小；分块传输的边读边数。
  test("超过 64 KiB 的请求体返回 413，Content-Length 声明的和分块传输的一样；在上限内的照常交给简介自己的规则", async () => {
    const { browser, userId } = await signedIn();
    const body = (kib: number) => ({ bio: "a".repeat(kib * 1024) });
    const patch = (kib: number, headers: Record<string, string>) =>
      browser.request("PATCH", "/api/v1/me/profile", { body: body(kib), headers });

    const chunked = await patch(70, { "transfer-encoding": "chunked" });
    const declared = await patch(70, { "content-length": String(JSON.stringify(body(70)).length) });
    const within = await patch(60, { "transfer-encoding": "chunked" });

    expect([chunked.status, chunked.json.error.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    expect([declared.status, declared.json.error.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    // 60 KiB 没被 413 挡掉，走到了简介自己的规则：超过 300 个字符。
    expect([within.status, within.json.error.code]).toEqual([400, "BIO_TOO_LONG"]);
    expect(await profileRow(userId)).toEqual([]);
  });
});
