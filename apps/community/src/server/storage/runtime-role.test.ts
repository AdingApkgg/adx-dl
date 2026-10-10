import { beforeAll, test, expect } from "bun:test";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import {
  acquireStorageMaintenance,
  releaseStorageMaintenance,
  createStorageIOTracker,
} from "./maintenance";
import { startStorageRole, createBackupCoordinator } from "./runtime-role";
beforeAll(resetTestDatabase, 30000);
test("actual role process ownership fences duplicates, waits active IO, resumes only matching gate and rejects replacement", async () => {
  const { db } = testDbHandle();
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const trackers = [createStorageIOTracker(), createStorageIOTracker(), createStorageIOTracker()];
  const roles = [];
  let release!: () => void;
  try {
    for (const [i, role] of (["web", "media", "control"] as const).entries())
      roles.push(await startStorageRole({ databaseUrl, role, tracker: trackers[i]! }));
    await expect(
      startStorageRole({ databaseUrl, role: "web", tracker: createStorageIOTracker() }),
    ).rejects.toThrow("STORAGE_ROLE_ALREADY_RUNNING");
    const pending = trackers[1]!.run(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      await trackers[1]!.run(async () => true);
    });
    const lease = await acquireStorageMaintenance(db, { durationMs: 10000 });
    const coordinator = createBackupCoordinator(databaseUrl)(lease.ownerId);
    let drained = false;
    const drain = coordinator.drain(lease, AbortSignal.timeout(5000)).then(() => {
      drained = true;
    });
    await Bun.sleep(700);
    expect(drained).toBe(false);
    expect(trackers[1]!.status()).toEqual({ paused: true, active: 1 });
    await expect(trackers[1]!.run(async () => true)).rejects.toThrow();
    release();
    await pending;
    await drain;
    await releaseStorageMaintenance(db, lease);
    await coordinator.resume(lease, AbortSignal.timeout(5000));
    expect(trackers.every((t) => !t.status().paused)).toBe(true);
    const next = await acquireStorageMaintenance(db, { durationMs: 5000 });
    await roles[0]!.stop();
    await expect(
      createBackupCoordinator(databaseUrl)(next.ownerId).drain(next, AbortSignal.timeout(1500)),
    ).rejects.toThrow();
    await releaseStorageMaintenance(db, next);
  } finally {
    release?.();
    await Promise.all(roles.map((r) => r.stop()));
  }
});
test("finished async parent cannot inherit tracker admission and start untracked nested IO during pause", async () => {
  const tracker = createStorageIOTracker();
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let late!: Promise<unknown>;
  await tracker.run(async () => {
    late = (async () => {
      await pending;
      return tracker.run(async () => "unsafe");
    })();
  });
  await tracker.pauseAndDrain(AbortSignal.timeout(100));
  release();
  await expect(late).rejects.toThrow();
  expect(tracker.status()).toEqual({ paused: true, active: 0 });
});

test("actual advisory session termination freezes role admission and invalidates readiness", async () => {
  const { pool } = testDbHandle(),
    tracker = createStorageIOTracker();
  const role = await startStorageRole({
    databaseUrl: process.env.TEST_DATABASE_URL!,
    role: "web",
    tracker,
  });
  const rows = await pool.query("select backend_pid from storage_runtime_roles where role='web'");
  await pool.query("select pg_terminate_backend($1)", [rows.rows[0].backend_pid]);
  for (let i = 0; i < 40 && !tracker.status().paused; i++) await Bun.sleep(25);
  expect(tracker.status().paused).toBe(true);
  expect(() => role.ready()).toThrow("STORAGE_ROLE_UNAVAILABLE");
  await expect(tracker.run(async () => true)).rejects.toThrow();
  await role.stop();
});
