import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createDb } from "../db/client";
import { testDatabaseUrl } from "../testing/services";
import { createBoss, enqueueInTx } from "./boss";

const url = testDatabaseUrl();
const { db, pool } = createDb(url, { max: 4 });
const migrator = createBoss(url, "migrator");
const sender = createBoss(url, "sender");
const queue = `test.enqueue.${crypto.randomUUID().slice(0, 8)}`;

for (const boss of [migrator, sender]) {
  boss.on("error", (error) => console.error(error));
}

beforeAll(async () => {
  await migrator.start();
  await migrator.createQueue(queue);
  await sender.start();
}, 30_000);

afterAll(async () => {
  await migrator.deleteQueue(queue);
  await sender.stop({ graceful: false, timeout: 1000 });
  await migrator.stop({ graceful: false, timeout: 1000 });
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
