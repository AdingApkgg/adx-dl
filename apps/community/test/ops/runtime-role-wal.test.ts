import { test, expect } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { createStorageIOTracker } from "../../src/server/storage/maintenance";
import { startStorageRole } from "../../src/server/storage/runtime-role";

// The wrapper creates a separate PostgreSQL instance with a test-only syscall shim.
const walTest = process.env.STORAGE_TEST_WAL_DELAY === "isolated-backend-only" ? test : test.skip;
walTest("a stalled real WAL sync still blocks business commits while ephemeral role heartbeats stay live", async () => {
  await resetTestDatabase();
  const directory = "/wal-delay";
  const { pool } = testDbHandle();
  const business = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  let role: Awaited<ReturnType<typeof startStorageRole>> | undefined;
  async function disarm() {
    await rm(`${directory}/target`, { force: true });
    await rm(`${directory}/entered`, { force: true });
    await rm(`${directory}/once`, { force: true });
    await rm(`${directory}/entered.tmp`, { force: true });
  }
  try {
    await business.connect();
    expect((await business.query("show synchronous_commit")).rows[0].synchronous_commit).toBe("on");
    expect((await business.query("show fsync")).rows[0].fsync).toBe("on");
    expect(["fdatasync", "fsync"]).toContain((await business.query("show wal_sync_method")).rows[0].wal_sync_method);
    const pid = (await business.query("select pg_backend_pid() as pid")).rows[0].pid;
    await writeFile(`${directory}/target`, String(pid), { mode: 0o644 });
    const began = performance.now();
    const commit = business.query("update storage_maintenance set updated_at=clock_timestamp() where id='global'");
    void commit.catch(() => {});
    let entered = false;
    for (let i = 0; i < 100; i++) {
      if (await Bun.file(`${directory}/entered`).exists()) { entered = true; break; }
      await Bun.sleep(20);
    }
    expect(entered).toBe(true);
    expect(Number(await Bun.file(`${directory}/entered`).text())).toBe(pid);
    const wait = await pool.query("select wait_event from pg_stat_activity where pid=$1", [pid]);
    expect(wait.rows[0].wait_event).toBe("WalSync");
    await commit;
    const businessWalSyncDelayMs = performance.now() - began;
    expect(businessWalSyncDelayMs).toBeGreaterThanOrEqual(2900);
    await disarm();

    const tracker = createStorageIOTracker();
    role = await startStorageRole({ databaseUrl: process.env.TEST_DATABASE_URL!, role: "media", tracker });
    const row = (await pool.query("select backend_pid from storage_runtime_roles where role='media'")).rows[0];
    await writeFile(`${directory}/target`, String(row.backend_pid), { mode: 0o644 });
    await Bun.sleep(4000);
    const roleSyncEntered = await Bun.file(`${directory}/entered`).exists();
    console.log(JSON.stringify({ businessWalSyncDelayMs, roleSyncEntered, roleLost: role.failure.aborted }));
    expect(role.failure.aborted).toBe(false);
    expect(roleSyncEntered).toBe(false);
    role.ready();
    expect(tracker.status().paused).toBe(false);
    const age = await pool.query("select extract(epoch from clock_timestamp()-heartbeat_at)::float as age from storage_runtime_roles where role='media'");
    expect(age.rows[0].age).toBeLessThan(1);
    expect((await business.query("show synchronous_commit")).rows[0].synchronous_commit).toBe("on");
    // Session loss must still immediately fence the same process after the async heartbeat change.
    await disarm();
    await pool.query("select pg_terminate_backend($1)", [row.backend_pid]);
    for (let i = 0; i < 80 && !role.failure.aborted; i++) await Bun.sleep(25);
    expect(role.failure.aborted).toBe(true);
    expect(tracker.status().paused).toBe(true);
    expect(() => role!.ready()).toThrow("STORAGE_ROLE_UNAVAILABLE");
  } finally {
    await disarm(); await role?.stop(); await business.end();
  }
}, 15000);
