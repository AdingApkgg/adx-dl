import { afterAll, beforeAll, expect, test } from "bun:test";
import { createBoss } from "../jobs/boss";
import { testDatabaseUrl } from "../testing/services";
import { sql } from "drizzle-orm";
import { testSender } from "../testing/test-boss";
import { testDbHandle } from "../testing/test-db";
import { enqueueStorageFlow } from "./flow";
import { STORAGE_INGEST_QUEUE, MEDIA_AVATAR_QUEUE, STORAGE_FINALIZE_QUEUE } from "../jobs/queues";
const names = [STORAGE_INGEST_QUEUE, MEDIA_AVATAR_QUEUE, STORAGE_FINALIZE_QUEUE];
const uploads: string[] = [];
beforeAll(testSender, 30000);
afterAll(async () => {
  for (const id of uploads)
    await testDbHandle().db.execute(sql`delete from pgboss.job where data->>'uploadId'=${id}`);
});
function data() {
  const uploadId = crypto.randomUUID();
  uploads.push(uploadId);
  return { uploadId, generation: 0 };
}
test("real flow transaction rollback removes every job and dependency", async () => {
  const boss = await testSender();
  const job = data();
  let ids: string[] = [];
  await expect(
    testDbHandle().db.transaction(async (tx) => {
      ids = await enqueueStorageFlow(boss, tx, job);
      throw Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(ids).toHaveLength(3);
  for (const [i, id] of ids.entries()) expect(await boss.findJobs(names[i], { id })).toEqual([]);
});
test("flow descendants wait for parent completion; singleton conflict aborts caller", async () => {
  const boss = await testSender();
  const job = data();
  const ids = await testDbHandle().db.transaction((tx) => enqueueStorageFlow(boss, tx, job));
  await expect(
    testDbHandle().db.transaction((tx) => enqueueStorageFlow(boss, tx, job)),
  ).rejects.toThrow();
  const rows = await testDbHandle().db.execute(
    sql`select name, id, blocked from pgboss.job where data->>'uploadId'=${job.uploadId}`,
  );
  expect(rows.rows).toHaveLength(3);
  expect(rows.rows.find((r) => r.id === ids[0])?.blocked).toBe(false);
  expect(rows.rows.find((r) => r.id === ids[1])?.blocked).toBe(true);
  expect(rows.rows.find((r) => r.id === ids[2])?.blocked).toBe(true);
  expect(await boss.fetch(MEDIA_AVATAR_QUEUE)).toEqual([]);
  expect(await boss.fetch(STORAGE_FINALIZE_QUEUE)).toEqual([]);
  const [first] = await boss.fetch(STORAGE_INGEST_QUEUE);
  expect(first.id).toBe(ids[0]);
  await boss.complete(STORAGE_INGEST_QUEUE, first.id);
  await boss.resolveFlow();
  const [second] = await boss.fetch(MEDIA_AVATAR_QUEUE);
  expect(second.id).toBe(ids[1]);
  expect(await boss.fetch(STORAGE_FINALIZE_QUEUE)).toEqual([]);
  await boss.complete(MEDIA_AVATAR_QUEUE, second.id);
  await boss.resolveFlow();
  const [third] = await boss.fetch(STORAGE_FINALIZE_QUEUE);
  expect(third.id).toBe(ids[2]);
  await boss.complete(STORAGE_FINALIZE_QUEUE, third.id);
});

test("actual worker supervisor resolves flow dependencies without manual resolution", async () => {
  const sender = await testSender();
  const job = data();
  const ids = await testDbHandle().db.transaction((tx) => enqueueStorageFlow(sender, tx, job));
  const worker = createBoss(testDatabaseUrl(), "worker");
  const errors: Error[] = [];
  worker.on("error", (error) => errors.push(error));
  await worker.start();
  try {
    expect(await sender.fetch(MEDIA_AVATAR_QUEUE)).toEqual([]);
    const [first] = await sender.fetch(STORAGE_INGEST_QUEUE);
    expect(first.id).toBe(ids[0]);
    await sender.complete(STORAGE_INGEST_QUEUE, first.id);
    let available = false;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const [row] = await sender.findJobs(MEDIA_AVATAR_QUEUE, { id: ids[1] });
      if (row && !row.blocked) {
        available = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(available).toBe(true);
    const [second] = await sender.fetch(MEDIA_AVATAR_QUEUE);
    expect(second.id).toBe(ids[1]);
    expect(await sender.fetch(STORAGE_FINALIZE_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await worker.stop({ graceful: false, timeout: 1000 });
  }
}, 15000);
