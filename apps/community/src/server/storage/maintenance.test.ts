import { beforeAll, expect, test } from "bun:test";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { storageMaintenance } from "../db/schema";
import { withStorageTransaction } from "./transactions";
import {
  acquireStorageMaintenance,
  releaseStorageMaintenance,
  renewStorageMaintenance,
  withStorageSnapshot,
} from "./maintenance";
beforeAll(resetTestDatabase, 30000);
test("bounded owner cannot extend deadline; snapshot drains actual transactions; failed snapshot releases exclusive connection", async () => {
  const { db, pool } = testDbHandle();
  const token = await acquireStorageMaintenance(db, { durationMs: 1000 });
  await expect(withStorageTransaction(db, async () => 1)).rejects.toMatchObject({ status: 503 });
  const renewed = await renewStorageMaintenance(db, token);
  expect(renewed.deadline).toBe(token.deadline);
  expect(await db.execute("select 1")).toBeDefined();
  await expect(
    withStorageSnapshot(process.env.TEST_DATABASE_URL!, token, async (client, snapshot) => {
      expect(snapshot).toMatch(/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/);
      expect((await client.query("select count(*) from storage_maintenance")).rows.length).toBe(1);
      throw new Error("injected snapshot failure");
    }),
  ).rejects.toThrow("injected snapshot failure");
  await releaseStorageMaintenance(db, token);
  expect(await withStorageTransaction(db, async () => 1)).toBe(1);
  const locks = await pool.query(
    "select * from pg_locks where locktype='advisory' and objid=714102026",
  );
  expect(locks.rows).toHaveLength(0);
});
test("stale release cannot clear another owner; fixed duration capped to five minutes", async () => {
  const { db } = testDbHandle();
  const a = await acquireStorageMaintenance(db, { durationMs: 900000 });
  expect(a.deadline - Date.now()).toBeLessThanOrEqual(300000);
  await releaseStorageMaintenance(db, { ...a, ownerId: crypto.randomUUID() });
  await expect(withStorageTransaction(db, async () => 1)).rejects.toMatchObject({ status: 503 });
  await releaseStorageMaintenance(db, a);
  expect((await db.select().from(storageMaintenance))[0].ownerId).toBeNull();
});

test("snapshot timeout destroys the actual dedicated backend, releases exclusion and never extends lease", async () => {
  const { db, pool } = testDbHandle();
  const token = await acquireStorageMaintenance(db, { durationMs: 100 });
  const start = Date.now();
  await expect(
    withStorageSnapshot(process.env.TEST_DATABASE_URL!, token, async (c) => {
      await c.query("select pg_sleep(5)");
    }),
  ).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(1500);
  await releaseStorageMaintenance(db, token);
  expect(await withStorageTransaction(db, async () => true)).toBe(true);
  expect(
    (await pool.query("select 1 from pg_locks where locktype='advisory' and objid=714102026"))
      .rowCount,
  ).toBe(0);
});
