import type { PgBoss } from "pg-boss";
import type { StorageContext } from "../server/storage/contracts";
import { StorageError } from "../server/storage/errors";
import { STORAGE_JOURNAL_QUEUE } from "../server/jobs/queues";
/** Task10 supplies the real encrypted append-only exporter and visibility barrier.
 * This scheduling seam never advances a checkpoint or invents export evidence. */
export type StorageJournalExporter = (ctx: StorageContext) => Promise<void>;
export async function exportStorageJournal(
  ctx: StorageContext,
  exporter?: StorageJournalExporter,
): Promise<void> {
  if (!exporter) {
    ctx.log.error("storage_journal_unavailable", { code: "STORAGE_UNAVAILABLE" });
    throw new StorageError(503, "STORAGE_UNAVAILABLE");
  }
  await exporter(ctx);
}
export async function registerStorageJournalWorker(
  ctx: StorageContext,
  boss: PgBoss,
  exporter?: StorageJournalExporter,
) {
  await boss.work(STORAGE_JOURNAL_QUEUE, async () => {
    await exportStorageJournal(ctx, exporter);
  });
  await boss.schedule(
    STORAGE_JOURNAL_QUEUE,
    "* * * * *",
    {},
    { tz: "Asia/Shanghai", missed: "once" },
  );
}
