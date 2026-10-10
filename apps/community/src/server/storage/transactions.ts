import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { DbTransaction } from "./contracts";
import { StorageError } from "./errors";

export const STORAGE_LOCK_KEY = 714102026;
/** Lock first: backup's exclusive lock must drain every existing storage transaction. */
export async function lockStorageMutation(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${STORAGE_LOCK_KEY})`);
  const lease = await tx.execute(
    sql`select 1 from storage_maintenance where id = 'global' and lease_until > clock_timestamp()`,
  );
  if (lease.rows.length > 0) throw new StorageError(503, "STORAGE_MAINTENANCE", "STORAGE_MAINTENANCE", 5);
}
export async function withStorageTransaction<T>(db: Db, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockStorageMutation(tx);
    return fn(tx);
  });
}
