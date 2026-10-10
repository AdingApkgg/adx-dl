import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { DbTransaction } from "./contracts";
import { StorageError } from "./errors";

export const STORAGE_LOCK_KEY = 714102026;
/** Admission is serialized with gate-close even when the lease is currently null. */
export async function lockStorageMutation(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '2s'`);
  await tx.execute(sql`set local statement_timeout = '5s'`);
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${STORAGE_LOCK_KEY})`);
  const row = await tx.execute(sql`select id from storage_maintenance where id='global' for share`);
  if (row.rows.length !== 1)
    throw new StorageError(503, "STORAGE_MAINTENANCE", "STORAGE_MAINTENANCE", 5);
  const lease = await tx.execute(
    sql`select 1 from storage_maintenance where id='global' and lease_until > clock_timestamp()`,
  );
  if (lease.rows.length)
    throw new StorageError(503, "STORAGE_MAINTENANCE", "STORAGE_MAINTENANCE", 5);
}
function isDeadline(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; cause?: unknown };
  return e.code === "55P03" || e.code === "57014" || (!!e.cause && isDeadline(e.cause));
}
export async function withStorageTransaction<T>(
  db: Db,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await lockStorageMutation(tx);
      return fn(tx);
    });
  } catch (error) {
    if (isDeadline(error)) throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 2);
    throw error;
  }
}
