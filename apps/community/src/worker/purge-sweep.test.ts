import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { shortId } from "@/server/auth/short-id";
import { user } from "@/server/db/schema";
import { USER_PURGE_DEAD_QUEUE, USER_PURGE_QUEUE } from "@/server/jobs/queues";
import { requestDeletion } from "@/server/services/user-deletion";
import { testSender } from "@/server/testing/test-boss";
import { testDbHandle } from "@/server/testing/test-db";
import { createLogger } from "@/shared/log";

import { runPurgeSweep } from "./purge-sweep";

const HOUR_MS = 3_600_000;

type SweepBoss = Pick<PgBoss, "send" | "findJobs">;

function setup(boss?: SweepBoss) {
  const lines: string[] = [];
  return {
    run: async () =>
      runPurgeSweep({
        db: testDbHandle().db,
        boss: boss ?? (await testSender()),
        log: createLogger((line) => lines.push(line)),
      }),
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

// 直接写一个用户行，状态和清除时间由用例定，不投递任务：模拟清除任务丢了。
async function userWith(status: "active" | "pending_deletion", purgeAt: Date): Promise<string> {
  const { db } = testDbHandle();
  const id = shortId();
  await db.insert(user).values({
    id,
    name: "测试",
    email: `${id}@placeholder.invalid`,
    status,
    deletionRequestedAt: purgeAt,
    deletionPurgeAt: purgeAt,
    deletionDeleteContent: false,
  });
  return id;
}

async function queuedPurgeJobs(userId: string) {
  return (await testSender()).findJobs(USER_PURGE_QUEUE, { key: userId, queued: true });
}

beforeAll(async () => {
  await testSender();
}, 30_000);

// 别的测试文件也会在测试库里留下注销中的账号：每条用例之前先补投一遍，把已经逾期的都投掉，
// 用例里的计数就只反映这条用例自己的数据。
beforeEach(async () => {
  await setup().run();
}, 30_000);

describe("每天补投丢了的清除任务", () => {
  test("注销中、清除时间过了一小时以上、没有任务：补投一个，warn 里只记数量", async () => {
    const id = await userWith("pending_deletion", new Date(Date.now() - 2 * HOUR_MS));
    const { run, logs } = setup();

    const result = await run();

    expect(result.requeued).toBe(1);
    const jobs = await queuedPurgeJobs(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ userId: id });
    expect(logs().find((entry) => entry.event === "user_purge_requeued")).toEqual({
      time: expect.any(String),
      level: "warn",
      event: "user_purge_requeued",
      count: 1,
    });
  }, 30_000);

  // 补投用的 singletonKey 和 requestDeletion 投递时一样：已有任务时 exclusive 让 send 返回 null。
  test("清除任务还在排队：不重复投递，计数 0", async () => {
    const { db } = testDbHandle();
    const id = shortId();
    await db.insert(user).values({ id, name: "测试", email: `${id}@placeholder.invalid` });
    await requestDeletion({ db, boss: testSender, handlers: [] }, id, { deleteContent: false });
    // worker 停了很久：清除时间已经过了两个小时，任务还没人领。
    await db
      .update(user)
      .set({ deletionPurgeAt: new Date(Date.now() - 2 * HOUR_MS) })
      .where(eq(user.id, id));
    const before = await queuedPurgeJobs(id);
    const { run, logs } = setup();

    const result = await run();

    expect(result.requeued).toBe(0);
    expect(before).toHaveLength(1);
    expect((await queuedPurgeJobs(id)).map((job) => job.id)).toEqual(before.map((job) => job.id));
    expect(logs().some((entry) => entry.event === "user_purge_requeued")).toBe(false);
  }, 30_000);

  test("还没到清除时间，或者过了不到一小时：不动", async () => {
    const later = await userWith("pending_deletion", new Date(Date.now() + 7 * 24 * HOUR_MS));
    const justDue = await userWith("pending_deletion", new Date(Date.now() - HOUR_MS / 2));

    const result = await setup().run();

    expect(result.requeued).toBe(0);
    expect(await queuedPurgeJobs(later)).toHaveLength(0);
    expect(await queuedPurgeJobs(justDue)).toHaveLength(0);
  }, 30_000);

  test("状态是 active 的不动，哪怕还留着过了期的清除时间", async () => {
    const id = await userWith("active", new Date(Date.now() - 2 * HOUR_MS));

    const result = await setup().run();

    expect(result.requeued).toBe(0);
    expect(await queuedPurgeJobs(id)).toHaveLength(0);
  }, 30_000);

  // 进了死信队列的清除任务要人来处理：没处理之前，每天记一条 error。
  test("死信队列里有清除任务时记一条 user_purge_dead_letters", async () => {
    await (await testSender()).send(USER_PURGE_DEAD_QUEUE, { userId: shortId() });
    const { run, logs } = setup();

    const result = await run();

    expect(result.deadLetters).toBeGreaterThanOrEqual(1);
    expect(logs().find((entry) => entry.event === "user_purge_dead_letters")).toMatchObject({
      level: "error",
      count: result.deadLetters,
    });
  }, 30_000);

  test("补投和查死信互不影响：一件出错，另一件照做；出错的记下来，最后抛出", async () => {
    const real = await testSender();
    const id = await userWith("pending_deletion", new Date(Date.now() - 2 * HOUR_MS));
    await real.send(USER_PURGE_DEAD_QUEUE, { userId: shortId() });

    const sendDown = setup({
      send: async () => {
        throw new Error("send is down");
      },
      findJobs: real.findJobs.bind(real),
    });
    await expect(sendDown.run()).rejects.toThrow("user.purge.sweep failed");
    expect(sendDown.logs().find((entry) => entry.event === "user_purge_dead_letters")).toBeDefined();
    expect(sendDown.logs().find((entry) => entry.event === "user_purge_sweep_failed")).toMatchObject({
      level: "error",
      step: "requeue",
      message: "send is down",
    });

    const findDown = setup({
      send: real.send.bind(real),
      findJobs: async () => {
        throw new Error("findJobs is down");
      },
    });
    await expect(findDown.run()).rejects.toThrow("user.purge.sweep failed");
    expect(await queuedPurgeJobs(id)).toHaveLength(1);
    expect(findDown.logs().find((entry) => entry.event === "user_purge_sweep_failed")).toMatchObject({
      level: "error",
      step: "dead_letters",
      message: "findJobs is down",
    });
  }, 30_000);
});
