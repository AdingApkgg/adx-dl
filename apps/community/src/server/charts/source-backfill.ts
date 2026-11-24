import { and, asc, eq, notExists, sql } from "drizzle-orm";
import { blobBlocks, blobs, chartSourceEntries, charts, chartVersions, files } from "../db/schema";
import type { DbTransaction, StorageContext } from "../storage/contracts";

export const chartBackfillSource = and(
  eq(blobs.state, "ready"),
  eq(blobs.detectedMime, "application/zip"),
  sql`exists (
    select 1 from ${files}
    join ${chartVersions} on ${chartVersions.sourceFileId} = ${files.id}
    join ${charts} on ${charts.id} = ${chartVersions.chartId}
    where ${files.blobId} = ${blobs.id} and ${files.state} = 'ready'
      and ${files.purpose} = 'chart-source' and ${files.deletedAt} is null
      and ${chartVersions.deletedAt} is null and ${charts.deletedAt} is null
  )`,
  sql`not exists (select 1 from ${blobBlocks} where ${blobBlocks.sha256} = ${blobs.sha256})`,
);

export function chartBackfillRemaining(ctx: { db: StorageContext["db"] | DbTransaction }, limit: number) {
  return ctx.db.select({ id: blobs.id, size: blobs.size }).from(blobs).where(and(chartBackfillSource,
    notExists(ctx.db.select({ ordinal: chartSourceEntries.ordinal }).from(chartSourceEntries)
      .where(eq(chartSourceEntries.sourceBlobId, blobs.id))),
  )).orderBy(asc(blobs.id)).limit(limit);
}
