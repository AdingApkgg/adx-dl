import { statfs } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { user, storageUsage, storageBudget } from "../db/schema";
import type { DbTransaction, StorageContext } from "./contracts";
import { StorageError, StorageUnavailableError } from "./errors";

/** Filesystem IO must happen before entering a business transaction. */
export async function checkStorageDisk(ctx: StorageContext): Promise<void> {
  try {
    const stats = await statfs(ctx.config.tempDir, { bigint: true });
    if (stats.bavail * stats.bsize < BigInt(ctx.config.limits.minFreeDiskBytes))
      throw new StorageUnavailableError();
  } catch {
    throw new StorageUnavailableError();
  }
}
export async function lockUploadAccounting(tx: DbTransaction, userId: string) {
  const [owner] = await tx.select().from(user).where(eq(user.id, userId)).for("update");
  if (owner?.status !== "active") throw new StorageError(403, "ACCOUNT_INACTIVE");
  await tx.insert(storageUsage).values({ userId }).onConflictDoNothing();
  const [usage] = await tx
    .select()
    .from(storageUsage)
    .where(eq(storageUsage.userId, userId))
    .for("update");
  const [budget] = await tx
    .select()
    .from(storageBudget)
    .where(eq(storageBudget.id, "global"))
    .for("update");
  if (!budget) throw new StorageUnavailableError();
  return { usage, budget };
}
export async function storageTime(tx: Pick<DbTransaction, "execute">): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(result.rows[0].now);
}
