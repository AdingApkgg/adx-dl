import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { shortId } from "../auth/short-id";
import { user } from "../db/schema";
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

describe("GET /api/v1/users/:id", () => {
  test("不用登录：给出 id、昵称、头像、简介、注册时间，别的字段（邮箱之类）一概不给", async () => {
    const app = newApp();
    const owner = new Browser(app);
    await signInWithGoogle(owner, googleProfile({ name: "阿丁", email: "ading@gmail.com" }));
    const id = await currentUserId(owner);
    await owner.request("PATCH", "/api/v1/me/profile", { body: { bio: "写谱的\n也打歌" } });

    const res = await app.request(`/api/v1/users/${id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id,
      status: "active",
      name: "阿丁",
      image: null,
      bio: "写谱的\n也打歌",
      createdAt: expect.any(String),
    });
  });

  test("还没写过简介：bio 是空串", async () => {
    const app = newApp();
    const owner = new Browser(app);
    await signInWithGoogle(owner, googleProfile());

    const res = await app.request(`/api/v1/users/${await currentUserId(owner)}`);

    expect(((await res.json()) as { bio: string }).bio).toBe("");
  });

  // 冷静期里主页只显示"该用户正在注销"（spec 第 10.5 节），昵称和简介不再公开。
  test("正在注销的用户：只给出 id 和状态", async () => {
    const app = newApp();
    const owner = new Browser(app);
    await signInWithGoogle(owner, googleProfile({ name: "要走的人" }));
    const id = await currentUserId(owner);
    await owner.request("PATCH", "/api/v1/me/profile", { body: { bio: "再见" } });
    await testDbHandle().db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, id));

    const res = await app.request(`/api/v1/users/${id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, status: "pending_deletion" });
  });

  test("格式对但不存在的 id、格式不对的 id：都是 404", async () => {
    const app = newApp();

    for (const id of [shortId(), "ABC2345678", "abc234567", "abc234567o", "%27%20or%201%3D1"]) {
      const res = await app.request(`/api/v1/users/${id}`);
      expect(res.status, id).toBe(404);
      expect(await res.json(), id).toEqual({ error: { code: "NOT_FOUND", message: "User not found" } });
    }
  });
});
