import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { shortId } from "@/server/auth/short-id";
import { account, profiles, user } from "@/server/db/schema";
import { type DeletionHandler, requestDeletion } from "@/server/services/user-deletion";
import { waitUntilDue } from "@/server/testing/deletion";
import { testSender } from "@/server/testing/test-boss";
import { testDbHandle } from "@/server/testing/test-db";
import { createLogger } from "@/shared/log";

import { createUserPurgeHandler } from "./purge";

beforeAll(async () => {
  await testSender();
}, 30_000);

function setup(handlers: readonly DeletionHandler[] = []) {
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  return {
    handle: createUserPurgeHandler({ db: testDbHandle().db, handlers, log }),
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

// 一个申请了注销的空账号：清除时间就是现在（等数据库的时钟走到那一刻，测试库的时钟可能比 JS 慢几毫秒）。
async function pendingEmptyAccount(handlers: readonly DeletionHandler[] = []) {
  const { db } = testDbHandle();
  const id = shortId();
  await db.insert(user).values({ id, name: "要走的人", email: `${id}@placeholder.invalid` });
  await db.insert(account).values({ accountId: `g-${crypto.randomUUID()}`, providerId: "google", userId: id });
  await db.insert(profiles).values({ userId: id, bio: "再见" });
  await requestDeletion({ db, boss: testSender, handlers }, id, { deleteContent: false });
  await waitUntilDue(id);
  return id;
}

async function userExists(id: string): Promise<boolean> {
  return (await testDbHandle().db.$count(user, eq(user.id, id))) === 1;
}

describe("user.purge 的处理函数", () => {
  // spec 第 13 节：同一个任务跑两遍，结果一样。
  test("同一个任务跑两遍：第一遍清除，第二遍什么也不做，都不报错", async () => {
    const id = await pendingEmptyAccount();
    const { handle, logs } = setup();
    const jobs = [{ data: { userId: id } }];

    await handle(jobs);
    await handle(jobs);

    expect(await userExists(id)).toBe(false);
    expect(logs().filter((entry) => entry.event === "user_purge")).toEqual([
      expect.objectContaining({ userId: id, result: "purged" }),
      expect.objectContaining({ userId: id, result: "skipped" }),
    ]);
  }, 30_000);

  // 失败要抛出去，pg-boss 才会按退避重试、重试用完进死信队列。日志只有用户 id 和错误本身。
  test("清除出错：抛出去，记一条 user_purge_failed；用户还在，下次重试照常清除", async () => {
    const failing: DeletionHandler = {
      name: "broken",
      hasContent: async () => false,
      purge: async () => {
        throw new Error("storage is down");
      },
    };
    const id = await pendingEmptyAccount([failing]);
    const broken = setup([failing]);

    await expect(broken.handle([{ data: { userId: id } }])).rejects.toThrow("storage is down");

    expect(broken.logs().find((entry) => entry.event === "user_purge_failed")).toEqual({
      time: expect.any(String),
      level: "error",
      event: "user_purge_failed",
      userId: id,
      name: "Error",
      message: "storage is down",
    });
    expect(await userExists(id)).toBe(true);
    await setup().handle([{ data: { userId: id } }]);
    expect(await userExists(id)).toBe(false);
  }, 30_000);

  test("任务里没有 userId：直接失败", async () => {
    const { handle } = setup();

    await expect(handle([{ data: {} as { userId: string } }])).rejects.toThrow("user.purge job has no userId");
  });
});
