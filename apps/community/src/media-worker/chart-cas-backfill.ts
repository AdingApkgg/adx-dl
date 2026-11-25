import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { chartBackfillSource } from "../server/charts/source-backfill";
import { blobs, chartSourceEntries, storageBudget } from "../server/db/schema";
import type { StorageContext } from "../server/storage/contracts";
import { StorageError, StorageUnavailableError } from "../server/storage/errors";
import { withStorageTransaction } from "../server/storage/transactions";
import { checkStorageDisk, storageTime } from "../server/storage/usage";
import { UUID_PATTERN } from "../server/uuid";
import { assertStorageNamespace } from "../worker/storage-delete";
import { copyVerified } from "./avatar";
import { materializeChartSourceFiles, type ChartCasAdmission } from "./chart-source-cas";
import { processChart } from "./chart-child";

export async function backfillChartSource(ctx: StorageContext, sourceId: string) {
  if (!UUID_PATTERN.test(sourceId)) throw new Error("INVALID_CHART_CAS_SOURCE");
  const source = await withStorageTransaction(ctx.db, async tx => {
    const [row] = await tx.select().from(blobs).where(and(eq(blobs.id, sourceId), chartBackfillSource));
    if (!row || (await tx.select({ ordinal: chartSourceEntries.ordinal }).from(chartSourceEntries)
      .where(eq(chartSourceEntries.sourceBlobId, sourceId)).limit(1)).length) return null;
    await assertStorageNamespace(tx, ctx, row.policyId, "original");
    return row;
  });
  if (!source) return { status: "skipped" } as const;
  const timeout = AbortSignal.timeout(120_000);
  const signal = ctx.lifecycle ? AbortSignal.any([ctx.lifecycle.signal, timeout]) : timeout;
  const admit: ChartCasAdmission = fn => withStorageTransaction(ctx.db, async tx => {
    signal.throwIfAborted();
    const [budget] = await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    if (!budget) throw new StorageUnavailableError();
    const [current] = await tx.select({ id: blobs.id }).from(blobs).where(and(eq(blobs.id, sourceId), chartBackfillSource));
    if (!current) throw new StorageError(503, "STORAGE_BUSY");
    return fn({ tx, budget, now: await storageTime(tx) });
  });
  await checkStorageDisk(ctx);
  const temporary = await mkdtemp(join(ctx.config.tempDir, "chart-cas-backfill-"));
  try {
    const archive = join(temporary, "original.zip");
    const files = join(temporary, "entries");
    await mkdir(files, { mode: 0o700 });
    await copyVerified(ctx, "original", source.key, archive, source.size, source.sha256, signal);
    const extracted = await processChart(archive, join(temporary, "preview"), signal, undefined, files);
    if (!extracted.entries) throw new StorageUnavailableError();
    await materializeChartSourceFiles(ctx, admit, source, extracted.entries, files, signal);
    return { status: "migrated", entries: extracted.entries.length } as const;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
