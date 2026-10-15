import { Client } from "pg";
import type { createStorageIOTracker, MaintenanceLease } from "./maintenance";
import { assertStorageDrained } from "../../../ops/backup/export";
const roleKeys = { web: 714102031, media: 714102032, control: 714102033 } as const;
type Role = keyof typeof roleKeys;
const failure = () => new Error("STORAGE_ROLE_UNAVAILABLE");
function connection(databaseUrl: string) {
  return new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
  });
}
function destroy(c: Client) {
  void c.end().catch(() => {});
  (c as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy();
}
/** One session owns each process role; disconnect freezes admission immediately. */
export async function startStorageRole({
  databaseUrl,
  role,
  tracker,
}: {
  databaseUrl: string;
  role: Role;
  tracker: ReturnType<typeof createStorageIOTracker>;
}) {
  const client = connection(databaseUrl),
    processId = crypto.randomUUID();
  const failureController = new AbortController();
  let stopped = false,
    lost = false,
    lastHealthy = 0,
    running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  tracker.pause();
  const lose = () => {
    if (lost) return;
    lost = true;
    tracker.pause();
    if (!stopped) failureController.abort(failure());
  };
  client.on("error", lose);
  client.on("end", lose);
  async function tick() {
    if (stopped) return;
    if (lost) throw failure();
    const gate = await client.query(
      "select owner_id from storage_maintenance where id='global' and lease_until>clock_timestamp()",
    );
    const owner = gate.rows[0]?.owner_id ?? null;
    let acknowledged = false;
    if (owner) {
      tracker.pause();
      if (tracker.status().active === 0) {
        try {
          await assertStorageDrained(client);
          acknowledged = true;
        } catch {
          /* Durable uncertain claims cannot acknowledge. */
        }
      }
    }
    // Never publish a stale owner after a gate transition while the durable check was in flight.
    const result = await client.query(
      `update storage_runtime_roles set heartbeat_at=clock_timestamp(),pause_owner=$3,
   acknowledged_at=case when $4::boolean then clock_timestamp() else null end
   where role=$1 and process_id=$2 and backend_pid=pg_backend_pid()
   and $3::uuid is not distinct from (select owner_id from storage_maintenance where id='global' and lease_until>clock_timestamp()) returning role`,
      [role, processId, owner, acknowledged],
    );
    if (stopped) return;
    if (lost) throw failure();
    if (result.rowCount !== 1) {
      tracker.pause();
      // A backup gate can change between the read and conditional heartbeat.
      // Retry that transition without replacing the coordinator's process IDs.
      const ownership = await client.query(
        "select 1 from storage_runtime_roles where role=$1 and process_id=$2 and backend_pid=pg_backend_pid()",
        [role, processId],
      );
      if (ownership.rowCount !== 1) throw failure();
      return;
    }
    if (!owner) tracker.resume();
    lastHealthy = Date.now();
  }
  async function poll() {
    running = tick().catch(() => {
      lose();
      destroy(client);
    });
    await running;
    if (!stopped && !lost) timer = setTimeout(() => void poll(), 500);
  }
  try {
    await client.connect();
    const lock = await client.query("select pg_try_advisory_lock($1) as acquired", [
      roleKeys[role],
    ]);
    if (!lock.rows[0]?.acquired) throw new Error("STORAGE_ROLE_ALREADY_RUNNING");
    await client.query(
      `insert into storage_runtime_roles(role,process_id,backend_pid,heartbeat_at) values($1,$2,pg_backend_pid(),clock_timestamp())
   on conflict(role) do update set process_id=excluded.process_id,backend_pid=excluded.backend_pid,heartbeat_at=excluded.heartbeat_at,pause_owner=null,acknowledged_at=null`,
      [role, processId],
    );
    await tick();
    timer = setTimeout(() => void poll(), 500);
  } catch (error) {
    lose();
    destroy(client);
    throw error;
  }
  return {
    processId,
    failure: failureController.signal,
    ready() {
      if (stopped || lost || Date.now() - lastHealthy > 2500) throw failure();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      tracker.pause();
      await running;
      try {
        if (!lost)
          await client.query("delete from storage_runtime_roles where role=$1 and process_id=$2", [
            role,
            processId,
          ]);
      } finally {
        destroy(client);
      }
    },
  };
}
const liveRoles = `select role,process_id,pause_owner,acknowledged_at from storage_runtime_roles r
 where heartbeat_at>clock_timestamp()-interval '3 seconds'
 and exists(select 1 from pg_locks l where l.pid=r.backend_pid and l.locktype='advisory' and l.granted
 and l.objid=case r.role when 'web' then 714102031 when 'media' then 714102032 when 'control' then 714102033 end)`;
export async function assertMediaProcess(databaseUrl: string) {
  const c = connection(databaseUrl);
  c.on("error", () => {});
  try {
    await c.connect();
    const rows = await c.query(`${liveRoles} and role='media'`);
    if (rows.rowCount !== 1) throw failure();
  } finally {
    destroy(c);
  }
}
/** Pure owner-bound handle, allocated before the exporter performs any side effect. */
export function createBackupCoordinator(databaseUrl: string) {
  return (ownerId: string) => {
    let expected: Map<string, string> | undefined;
    async function wait(lease: MaintenanceLease, signal: AbortSignal, resuming: boolean) {
      if (lease.ownerId !== ownerId) throw failure();
      const c = connection(databaseUrl);
      c.on("error", () => {});
      const abort = () => destroy(c);
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        await c.connect();
        for (;;) {
          signal.throwIfAborted();
          const gate = await c.query(
            "select owner_id from storage_maintenance where id='global' and lease_until>clock_timestamp()",
          );
          const current = gate.rows[0]?.owner_id;
          if (resuming ? current !== undefined : current !== ownerId) throw failure();
          const rows = (await c.query(liveRoles)).rows;
          if (!expected) {
            if (rows.length !== 3) throw failure();
            expected = new Map(rows.map((r) => [r.role, r.process_id]));
          }
          if (rows.some((r) => expected!.get(r.role) !== r.process_id)) throw failure();
          if (
            rows.length === 3 &&
            rows.every((r) =>
              resuming
                ? r.pause_owner === null
                : r.pause_owner === ownerId && r.acknowledged_at !== null,
            )
          ) {
            if (!resuming) await assertStorageDrained(c);
            signal.throwIfAborted();
            return;
          }
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(done, 100);
            function done() {
              signal.removeEventListener("abort", cancel);
              resolve();
            }
            function cancel() {
              clearTimeout(timer);
              signal.removeEventListener("abort", cancel);
              reject(failure());
            }
            signal.addEventListener("abort", cancel, { once: true });
            if (signal.aborted) cancel();
          });
        }
      } finally {
        signal.removeEventListener("abort", abort);
        destroy(c);
      }
    }
    return {
      drain: (lease: MaintenanceLease, signal: AbortSignal) => wait(lease, signal, false),
      resume: (lease: MaintenanceLease, signal: AbortSignal) => wait(lease, signal, true),
    };
  };
}
