import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createDb } from "../db/client";
import { testDatabaseUrl } from "../testing/services";
import { prepareTestQueues, testSender } from "../testing/test-boss";
import { assertQueueExists, createBoss, enqueueInTx, getSender, stopSender } from "./boss";
import { USER_PURGE_QUEUE } from "./queues";

const url = testDatabaseUrl();
const { db, pool } = createDb(url, { max: 4 });
const migrator = createBoss(url, "migrator");
const sender = createBoss(url, "sender");
const queue = `test.enqueue.${crypto.randomUUID().slice(0, 8)}`;

for (const boss of [migrator, sender]) {
  boss.on("error", (error) => console.error(error));
}

// 先把测试库（包括 pgboss schema）重建好，再起这里自己的实例：重建会删掉整个 pgboss schema。
beforeAll(async () => {
  await prepareTestQueues();
  await migrator.start();
  await migrator.createQueue(queue);
  await sender.start();
}, 30_000);

afterAll(async () => {
  await migrator.deleteQueue(queue);
  await sender.stop({ graceful: false, timeout: 1000 });
  await migrator.stop({ graceful: false, timeout: 1000 });
  await stopSender();
  await pool.end();
});

describe("enqueueInTx", () => {
  test("事务回滚时，任务一起消失", async () => {
    let jobId: string | null = null;

    await expect(
      db.transaction(async (tx) => {
        jobId = await enqueueInTx(sender, tx, queue, { n: 1 });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");

    expect(jobId).not.toBeNull();
    expect(await sender.findJobs(queue, { id: jobId ?? "" })).toEqual([]);
  });

  test("事务提交后任务存在，data 是对象", async () => {
    const jobId = await db.transaction((tx) => enqueueInTx(sender, tx, queue, { n: 2 }));
    const jobs = await sender.findJobs(queue, { id: jobId ?? "" });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ n: 2 });
  });
});

describe("getSender", () => {
  // 网页进程启动时 PG 可能还连不上、迁移可能还没跑：失败的启动不能被缓存下来，否则要重启进程才能恢复。
  test(
    "启动失败时不缓存，下次调用重新启动；成功后一直是同一个，stopSender 之后再要是新的",
    async () => {
      const errors: Error[] = [];
      const onError = (error: Error) => errors.push(error);
      // 端口 9 没有程序监听：连接被立刻拒绝。
      const unreachable = "postgres://community:community@127.0.0.1:9/community_test";

      await expect(getSender(unreachable, onError)).rejects.toThrow();
      const first = await getSender(url, onError);
      const again = await getSender(url, onError);
      await stopSender();
      const fresh = await getSender(url, onError);

      expect(again).toBe(first);
      expect(fresh).not.toBe(first);
      expect(await fresh.getQueue(USER_PURGE_QUEUE)).toMatchObject({ name: USER_PURGE_QUEUE });
    },
    30_000
  );
});

describe("assertQueueExists", () => {
  test(
    "队列在就通过；不在就报出队列名",
    async () => {
      const boss = await testSender();

      await assertQueueExists(boss, USER_PURGE_QUEUE);
      await expect(assertQueueExists(boss, "nope.missing")).rejects.toThrow("queue nope.missing is missing");
    },
    30_000
  );
});
