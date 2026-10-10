import { beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { storageMaintenance } from "../db/schema";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { STORAGE_LOCK_KEY, withStorageTransaction } from "./transactions";

beforeAll(resetTestDatabase, 30_000);
test("live maintenance rejects mutations, expired leases permit them and errors roll back", async () => {
  const { db } = testDbHandle();
  await db
    .update(storageMaintenance)
    .set({ ownerId: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60_000) });
  let called = false;
  try {
    await expect(
      withStorageTransaction(db, async () => {
        called = true;
      }),
    ).rejects.toMatchObject({ status: 503, code: "STORAGE_MAINTENANCE" });
    expect(called).toBe(false);
    await db.update(storageMaintenance).set({ leaseUntil: new Date(Date.now() - 1_000) });
    expect(await withStorageTransaction(db, async () => "ok")).toBe("ok");
    await expect(
      withStorageTransaction(db, async (tx) => {
        await tx.execute(sql`update storage_budget set temporary_reserved = 77 where id = 'global'`);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const rows = await db.execute<{ temporary_reserved: string }>(
      sql`select temporary_reserved from storage_budget`,
    );
    expect(Number(rows.rows[0]!.temporary_reserved)).toBe(0);
  } finally {
    await db.update(storageMaintenance).set({ ownerId: null, leaseUntil: null });
  }
});

test("shared locks coexist, exclusive lock drains writers, and lease is checked after exclusive unlock", async () => {
  const { db, pool } = testDbHandle();
  let releaseWriter!: () => void;
  let enteredWriter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredWriter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const writer = withStorageTransaction(db, async () => {
    enteredWriter();
    await held;
  });
  await entered;
  expect(await withStorageTransaction(db, async () => "second")).toBe("second");
  const exclusive = await pool.connect();
  try {
    expect(
      (await exclusive.query("select pg_try_advisory_lock($1::bigint) as acquired", [STORAGE_LOCK_KEY]))
        .rows[0].acquired,
    ).toBe(false);
    releaseWriter();
    await writer;
    await exclusive.query("select pg_advisory_lock($1::bigint)", [STORAGE_LOCK_KEY]);
    let callbackRan = false;
    const pending = withStorageTransaction(db, async () => {
      callbackRan = true;
    });
    // Wait until PostgreSQL itself reports a waiting shared advisory request.
    for (let n = 0; n < 100; n++) {
      const waiting = await exclusive.query(
        "select 1 from pg_locks where locktype = 'advisory' and objid = $1 and not granted",
        [STORAGE_LOCK_KEY],
      );
      if (waiting.rows.length > 0) break;
      if (n === 99) throw new Error("shared mutation did not wait for backup lock");
      await Bun.sleep(5);
    }
    expect(callbackRan).toBe(false);
    await exclusive.query(
      "update storage_maintenance set owner_id=$1, lease_until=clock_timestamp()+interval '1 minute' where id='global'",
      [crypto.randomUUID()],
    );
    await exclusive.query("select pg_advisory_unlock($1::bigint)", [STORAGE_LOCK_KEY]);
    await expect(pending).rejects.toMatchObject({ code: "STORAGE_MAINTENANCE" });
    expect(callbackRan).toBe(false);
  } finally {
    releaseWriter();
    await exclusive.query("select pg_advisory_unlock_all()");
    exclusive.release();
    await db.update(storageMaintenance).set({ ownerId: null, leaseUntil: null });
  }
});
