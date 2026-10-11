import { beforeAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { createDb } from "../../src/server/db/client";
import { storageBudget, storageQuarantine } from "../../src/server/db/schema";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { readyContext } from "./ready-file";
import { acquireStorageMaintenance, releaseStorageMaintenance } from "../../src/server/storage/maintenance";
import { settleSuccessfulQuarantineDelete, type SuccessfulQuarantineDelete } from "../../src/server/storage/publication";
import { cleanupStorageQuarantine } from "../../src/worker/storage-reconcile";

let fixture: Awaited<ReturnType<typeof readyContext>>;
beforeAll(async () => { await resetTestDatabase(); fixture = await readyContext(); }, 30000);
function budget(ms: number) {
  const end = performance.now() + ms;
  return { remaining: () => Math.max(0, end - performance.now()), check() {
    if (performance.now() >= end) throw new Error("test budget expired");
  } };
}
async function candidate(quarantined = false) {
  const { ctx, policy } = fixture;
  const hash = crypto.randomUUID().replaceAll("-", "").repeat(2), now = new Date();
  const [row] = await ctx.db.insert(storageQuarantine).values({
    policyId: policy.id, sha256: hash, key: `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
    size: 7, observedEtag: "revision1", generation: quarantined ? 1 : 2,
    state: quarantined ? "quarantined" : "deleting", deleteStartedAt: quarantined ? null : now,
    lastObservedAt: new Date(now.getTime() - 3 * 86400000),
  }).returning();
  const [account] = await ctx.db.select().from(storageBudget);
  await ctx.db.update(storageBudget).set({ originalWritten: account.originalWritten + row.size });
  return { row, before: account.originalWritten, claim: { ...row, deleteStartedAt: now } satisfies SuccessfulQuarantineDelete };
}
async function state(id: string) {
  const [row] = await fixture.ctx.db.select().from(storageQuarantine).where(eq(storageQuarantine.id, id));
  const [account] = await fixture.ctx.db.select().from(storageBudget);
  return { state: row.state, charged: account.originalWritten, uncertain: row.deleteUncertain };
}
async function remove(c: Awaited<ReturnType<typeof candidate>>) {
  await fixture.ctx.db.delete(storageQuarantine).where(eq(storageQuarantine.id, c.row.id));
  await fixture.ctx.db.update(storageBudget).set({ originalWritten: c.before });
}

test("R44 production-budget quarantine DELETE settles once after admission closes", async () => {
  const c = await candidate(true), { ctx } = fixture;
  let lease: Awaited<ReturnType<typeof acquireStorageMaintenance>> | undefined;
  let deletes = 0;
  try {
    const scoped = { ...ctx, driver: { ...ctx.driver,
      head: async () => ({ size: c.row.size, sha256: c.row.sha256, etag: c.row.observedEtag!, mime: "image/png" }),
      delete: async () => { deletes++; lease = await acquireStorageMaintenance(ctx.db); },
    } };
    expect(await cleanupStorageQuarantine(scoped, 1, budget(10000))).toMatchObject({ deleted: 1, storageFailures: 0 });
    expect(deletes).toBe(1);
    expect(await state(c.row.id)).toMatchObject({ state: "deleted", charged: c.before });
    expect(await settleSuccessfulQuarantineDelete(ctx, c.claim, budget(1000))).toBe(false);
    expect(await state(c.row.id)).toMatchObject({ state: "deleted", charged: c.before });
  } finally { if (lease) await releaseStorageMaintenance(ctx.db, lease); await remove(c); }
});

test("R44 settlement pool deadline discards the late real client without touching the claim", async () => {
  const c = await candidate(), { ctx } = fixture;
  const lease = await acquireStorageMaintenance(ctx.db);
  const { db, pool } = createDb(process.env.TEST_DATABASE_URL!, { max: 1 });
  let blocker: PoolClient | undefined = await pool.connect();
  let destroyed = 0;
  const connect = pool.connect;
  pool.connect = (async () => {
    const client = await Reflect.apply(connect, pool, []);
    const release = client.release.bind(client);
    client.release = (error?: Error | boolean) => { if (error === true) destroyed++; release(error); };
    return client;
  }) as typeof pool.connect;
  try {
    await expect(settleSuccessfulQuarantineDelete({ ...ctx, db }, c.claim, budget(100))).rejects.toMatchObject({ code: "MEDIA_ATTEMPT_DEADLINE" });
    pool.connect = connect;
    blocker.release(); blocker = undefined;
    await db.execute(sql`select 1`);
    expect(destroyed).toBe(1);
    expect(pool.waitingCount).toBe(0);
    expect(await state(c.row.id)).toMatchObject({ state: "deleting", charged: c.before + c.row.size });
  } finally { pool.connect = connect; blocker?.release(); await pool.end(); await releaseStorageMaintenance(ctx.db, lease); await remove(c); }
});

for (const phase of ["begin", "commit", "commit-ack"] as const) {
  test(`R44 settlement ${phase} stall destroys its connection and preserves authoritative state`, async () => {
    const c = await candidate(), { ctx } = fixture;
    const lease = await acquireStorageMaintenance(ctx.db);
    const { db, pool } = createDb(process.env.TEST_DATABASE_URL!, { max: 1 });
    const connect = pool.connect;
    let unblock!: () => void, entered = false, destroyed = 0, backend: number | undefined;
    const barrier = new Promise<void>(resolve => { unblock = resolve; });
    pool.connect = (async () => {
      const client = await Reflect.apply(connect, pool, []);
      const query = client.query, release = client.release.bind(client);
      backend = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
      client.release = (error?: Error | boolean) => { if (error === true) destroyed++; release(error); };
      client.query = (async (...args: unknown[]) => {
        const text = typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text;
        const target = phase === "begin" ? "begin" : "commit";
        if (text === target) {
          entered = true;
          if (phase === "commit-ack") { const result = await Reflect.apply(query, client, args); await barrier; return result; }
          await barrier;
        }
        return Reflect.apply(query, client, args);
      }) as PoolClient["query"];
      return client;
    }) as typeof pool.connect;
    try {
      const started = performance.now();
      await expect(settleSuccessfulQuarantineDelete({ ...ctx, db }, c.claim, budget(1000))).rejects.toMatchObject({ code: "MEDIA_ATTEMPT_DEADLINE" });
      expect(performance.now() - started).toBeLessThan(3000);
      expect(entered).toBe(true);
      expect(destroyed).toBe(1);
      pool.connect = connect;
      unblock();
      expect(await state(c.row.id)).toMatchObject({ state: phase === "commit-ack" ? "deleted" : "deleting", charged: c.before + (phase === "commit-ack" ? 0 : c.row.size) });
      const active = await testDbHandle().pool.query("select 1 from pg_stat_activity where pid=$1", [backend]);
      expect(active.rowCount).toBe(0);
      if (phase === "commit-ack") {
        expect(await settleSuccessfulQuarantineDelete(ctx, c.claim, budget(1000))).toBe(false);
        expect((await state(c.row.id)).charged).toBe(c.before);
      }
    } finally { pool.connect = connect; unblock(); await pool.end(); await releaseStorageMaintenance(ctx.db, lease); await remove(c); }
  });
}
