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
  expect(role.failure.aborted).toBe(true);
  expect(() => role.ready()).toThrow("STORAGE_ROLE_UNAVAILABLE");
  await expect(tracker.run(async () => true)).rejects.toThrow();
  await role.stop();
});

test("normal role shutdown does not report session loss", async () => {
  const role = await startStorageRole({
    databaseUrl: process.env.TEST_DATABASE_URL!,
    role: "web",
    tracker: createStorageIOTracker(),
  });
  await role.stop();
  expect(role.failure.aborted).toBe(false);
});

test("stopping during a heartbeat waits for it without destroying the normal cleanup connection", async () => {
  const { pool } = testDbHandle();
  const tracker = createStorageIOTracker();
  const role = await startStorageRole({databaseUrl: process.env.TEST_DATABASE_URL!,role:"web",tracker});
  const blocker = await pool.connect();
  try {
    await blocker.query("begin");
    await blocker.query("select 1 from storage_runtime_roles where role='web' for update");
    let waiting = false;
    for(let i=0;i<60;i++) {
      const row = await pool.query("select wait_event_type from pg_stat_activity where pid=(select backend_pid from storage_runtime_roles where role='web')");
      if(row.rows[0]?.wait_event_type === "Lock") {waiting=true;break;}
      await Bun.sleep(25);
    }
    expect(waiting).toBe(true);
    const stopped = role.stop();
    await blocker.query("rollback");
    await stopped;
    expect(role.failure.aborted).toBe(false);
    expect((await pool.query("select 1 from storage_runtime_roles where role='web'")).rowCount).toBe(0);
  } finally {
    await blocker.query("rollback");blocker.release();await role.stop();
  }
});

test("conditional heartbeat miss pauses the current owner then retries without reporting loss", async () => {
  const { pool } = testDbHandle();
  const tracker = createStorageIOTracker();
  const role = await startStorageRole({databaseUrl: process.env.TEST_DATABASE_URL!,role:"web",tracker});
  try {
    // Force the same zero-row result as the maintenance owner's conditional UPDATE.
    await pool.query(`create sequence role_heartbeat_misses;
      create function skip_first_heartbeat() returns trigger language plpgsql as $$
      begin if NEW.role='web' and nextval('role_heartbeat_misses')=1 then return null; end if; return NEW; end $$;
      create trigger skip_first_heartbeat before update on storage_runtime_roles for each row execute function skip_first_heartbeat()`);
    for(let i=0;i<60 && !tracker.status().paused;i++) await Bun.sleep(25);
    expect(tracker.status().paused).toBe(true);
    expect(role.failure.aborted).toBe(false);
    for(let i=0;i<60 && tracker.status().paused;i++) await Bun.sleep(25);
    expect(tracker.status().paused).toBe(false);
    role.ready();
  } finally {
    await pool.query("drop trigger if exists skip_first_heartbeat on storage_runtime_roles; drop function if exists skip_first_heartbeat(); drop sequence if exists role_heartbeat_misses");
    await role.stop();
  }
});

test("replaced role ownership freezes admission and reports session loss", async () => {
  const { pool } = testDbHandle();
  const tracker = createStorageIOTracker();
  const role = await startStorageRole({
    databaseUrl: process.env.TEST_DATABASE_URL!, role: "web", tracker,
  });
  try {
    await pool.query("update storage_runtime_roles set process_id=$1 where role='web'", [crypto.randomUUID()]);
    for (let i=0;i<80 && !role.failure?.aborted;i++) await Bun.sleep(25);
    expect(role.failure?.aborted).toBe(true);
    await expect(tracker.run(async () => "unsafe")).rejects.toThrow();
    expect(() => role.ready()).toThrow("STORAGE_ROLE_UNAVAILABLE");
  } finally {
    await role.stop();
  }
});

test("terminated PostgreSQL ownership drains and exits the actual role process", async () => {
  const { pool } = testDbHandle();
  const child = Bun.spawn([process.execPath,"--eval",`
    import { startStorageRole } from ${JSON.stringify(new URL("./runtime-role.ts",import.meta.url).href)};
    import { createStorageIOTracker } from ${JSON.stringify(new URL("./maintenance.ts",import.meta.url).href)};
    import { superviseStorageRole } from ${JSON.stringify(new URL("./process-supervision.ts",import.meta.url).href)};
    const tracker=createStorageIOTracker();
    const role=await startStorageRole({databaseUrl:process.env.TEST_DATABASE_URL,role:"media",tracker});
    superviseStorageRole(role.failure,async()=>{
      console.log("paused="+tracker.status().paused);
      await role.stop();console.log("drained");
    },2000);
  `],{stdout:"pipe",stderr:"pipe"});
  const out=new Response(child.stdout).text(),err=new Response(child.stderr).text();
  const timer=setTimeout(()=>child.kill("SIGKILL"),5000);
  try {
    let pid:number|undefined;
    for(let i=0;i<80 && !pid;i++) {
      const result=await pool.query("select backend_pid from storage_runtime_roles where role='media' and heartbeat_at>clock_timestamp()-interval '2 seconds'");
      pid=result.rows[0]?.backend_pid;
      if(!pid)await Bun.sleep(25);
    }
    expect(pid).toBeDefined();
    await pool.query("select pg_terminate_backend($1)",[pid]);
    expect(await child.exited).toBe(1);
    expect(await out).toBe("paused=true\ndrained\n");
    expect(await err).toBe("STORAGE_ROLE_LOST\n");
  } finally {
    clearTimeout(timer);child.kill();await child.exited;
  }
});
