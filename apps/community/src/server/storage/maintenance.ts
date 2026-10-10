import { Client } from "pg";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { STORAGE_LOCK_KEY } from "./transactions";
import { StorageError } from "./errors";
export const MAX_MAINTENANCE_MS = 300000;
export type MaintenanceLease = { ownerId: string; deadline: number };
const unavailable = () => new StorageError(503, "STORAGE_MAINTENANCE", "STORAGE_MAINTENANCE", 5);
export async function acquireStorageMaintenance(
  db: Db,
  {
    durationMs = MAX_MAINTENANCE_MS,
    ownerId = crypto.randomUUID(),
  }: { durationMs?: number; ownerId?: string } = {},
): Promise<MaintenanceLease> {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1)
    throw new TypeError("Invalid maintenance duration");
  if (!/^[a-f0-9-]{36}$/.test(ownerId)) throw new TypeError("Invalid maintenance owner");
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout='2s'`);
    await tx.execute(sql`set local statement_timeout='5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock_shared(${STORAGE_LOCK_KEY})`);
    const r = await tx.execute<{ owner_id: string | null; lease_until: Date | null }>(
      sql`select owner_id,lease_until from storage_maintenance where id='global' for update`,
    );
    if (r.rows.length !== 1) throw unavailable();
    const updated = await tx.execute<{ deadline: Date }>(
      sql`update storage_maintenance set owner_id=${ownerId}::uuid,lease_until=clock_timestamp()+${Math.min(durationMs, MAX_MAINTENANCE_MS)}*interval '1 millisecond',updated_at=clock_timestamp() where id='global' and (lease_until is null or lease_until<=clock_timestamp()) returning lease_until as deadline`,
    );
    if (updated.rows.length !== 1) throw unavailable();
    return { ownerId, deadline: new Date(updated.rows[0].deadline).getTime() };
  });
}
/** Heartbeat never extends the original hard deadline. */
export async function renewStorageMaintenance(
  db: Db,
  token: MaintenanceLease,
): Promise<MaintenanceLease> {
  const r = await db.execute(
    sql`update storage_maintenance set updated_at=clock_timestamp() where id='global' and owner_id=${token.ownerId}::uuid and lease_until>clock_timestamp() returning id`,
  );
  if (r.rows.length !== 1) throw unavailable();
  return token;
}
export async function releaseStorageMaintenance(db: Db, token: MaintenanceLease): Promise<void> {
  await db.execute(
    sql`update storage_maintenance set owner_id=null,lease_until=null,updated_at=clock_timestamp() where id='global' and owner_id=${token.ownerId}::uuid`,
  );
}
/** Dedicated connection; acquire session exclusion BEFORE the MVCC snapshot. Never return it to a pool. */
export async function withStorageSnapshot<T>(
  url: string,
  token: MaintenanceLease,
  fn: (client: Client, snapshot: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const remaining = () => Math.max(0, token.deadline - Date.now());
  if (!remaining()) throw unavailable();
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: Math.min(5000, remaining()),
  });
  client.on("error", () => {});
  const controller = new AbortController();
  const close = () => {
    const ending = client.end().catch(() => {});
    // This dedicated session is never pooled. Force transport close even when idle goodbye stalls.
    (
      client as unknown as { connection?: { stream?: { destroy(): void } } }
    ).connection?.stream?.destroy();
    return ending;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void close();
      reject(unavailable());
    }, remaining());
  });
  const run = async () => {
    await client.connect();
    await client.query(
      "select set_config('lock_timeout',$1,false),set_config('statement_timeout',$1,false),set_config('idle_session_timeout',$1,false)",
      [String(Math.max(1, remaining()))],
    );
    await client.query("select pg_advisory_lock($1::bigint)", [STORAGE_LOCK_KEY]);
    await client.query("select set_config('transaction_timeout',$1,false)", [
      String(Math.max(1, remaining())),
    ]);
    await client.query("begin isolation level repeatable read read only");
    const valid = await client.query(
      "select 1 from storage_maintenance where id='global' and owner_id=$1 and lease_until>clock_timestamp()",
      [token.ownerId],
    );
    if (valid.rowCount !== 1) throw unavailable();
    const snapshot = (await client.query("select pg_export_snapshot() as snapshot")).rows[0]
      .snapshot;
    const result = await fn(client, snapshot, controller.signal);
    controller.signal.throwIfAborted();
    await client.query("commit");
    // Clear admission on this SAME exclusive session; a second shared session would deadlock.
    await client.query(
      "update storage_maintenance set owner_id=null,lease_until=null,updated_at=clock_timestamp() where id='global' and owner_id=$1",
      [token.ownerId],
    );
    await client.query("select pg_advisory_unlock($1::bigint)", [STORAGE_LOCK_KEY]);
    return result;
  };
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await close();
  }
}

/** Runtime Task11 supplies one tracker per actual role process, and authenticates fresh owner-scoped ACKs. */
export function createStorageIOTracker() {
  let paused = false;
  let active = 0;
  const waiters = new Set<() => void>();
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (paused) throw unavailable();
      active++;
      try {
        return await fn();
      } finally {
        active--;
        if (!active) for (const wake of waiters) wake();
      }
    },
    async pauseAndDrain(signal: AbortSignal) {
      paused = true;
      signal.throwIfAborted();
      if (active)
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            cleanup();
            resolve();
          };
          const abort = () => {
            cleanup();
            reject(unavailable());
          };
          const cleanup = () => {
            waiters.delete(done);
            signal.removeEventListener("abort", abort);
          };
          waiters.add(done);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      signal.throwIfAborted();
      if (active) throw unavailable();
    },
    resume() {
      paused = false;
    },
    status() {
      return { paused, active };
    },
  };
}
export function trackStorageWrites(
  driver: import("./contracts").ObjectDriver,
  tracker: ReturnType<typeof createStorageIOTracker>,
): import("./contracts").ObjectDriver {
  return {
    ...driver,
    put: (i) => tracker.run(() => driver.put(i)),
    delete: (i) => tracker.run(() => driver.delete(i)),
    copy: (i) => tracker.run(() => driver.copy(i)),
  };
}
