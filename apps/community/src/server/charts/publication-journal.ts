import { permissionFact } from "@/shared/chart-journal";
import { eq } from "drizzle-orm";
import type { ChartPublicationDto } from "@/shared/charts";
import { chartModerations, chartPublicIds, storageJournalProgress, storageTombstones } from "../db/schema";
import type { StorageContext, DbTransaction } from "../storage/contracts";
import { StorageUnavailableError } from "../storage/errors";
import { STORAGE_JOURNAL_QUEUE } from "../jobs/queues";
export async function recordPermission(
  tx: DbTransaction,
  chartId: string,
  revision: number,
  publication: ChartPublicationDto | null,
  createdAt: Date,
  userId?: string,
) {
  const [identity] = await tx.select().from(chartPublicIds).where(eq(chartPublicIds.chartId, chartId));
  const [moderation] = await tx.select().from(chartModerations).where(eq(chartModerations.chartId, chartId));
  const payload = permissionFact.parse({ version: 2, chartId, revision, publication,
    ...(moderation ? { moderation: { revision: moderation.revision, actorId: moderation.actorId, actorPublicId: moderation.actorPublicId.toString(),
      reason: moderation.reason, createdAt: moderation.createdAt.toISOString(), publication: moderation.publication, author: moderation.author } } : {}),
    ...(identity ? { publicId: identity.publicId.toString() } : {}) });
  const [r] = await tx
    .insert(storageTombstones)
    .values({
      kind: "chart_permission",
      userId,
      payload,
      createdAt,
    })
    .returning({ sequence: storageTombstones.sequence });
  return r.sequence;
}
/** Exact fact already committed; never run an exporter while holding the shared maintenance lock. */
export async function awaitChartJournal(ctx: StorageContext, sequence: number) {
  if (!sequence) return;
  try {
    const exported = async () => {
      const [p] = await ctx.db
        .select()
        .from(storageJournalProgress)
        .where(eq(storageJournalProgress.id, "global"));
      return !!(p && p.exportedSequence >= sequence && p.chainHash && p.exportedAt);
    };
    if (await exported()) return;
    if (ctx.exportChartJournal) await ctx.exportChartJournal();
    else
      await (await ctx.boss()).send(STORAGE_JOURNAL_QUEUE, {}, { singletonKey: "chart-barrier" });
    const deadline = Date.now() + 10000;
    do {
      if (await exported()) return;
      if (ctx.exportChartJournal) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
  } catch {
    throw new StorageUnavailableError();
  }
  throw new StorageUnavailableError();
}
