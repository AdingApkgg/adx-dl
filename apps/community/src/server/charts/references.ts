import { and, eq, isNull, sql } from "drizzle-orm";
import { files } from "../db/schema/storage";
import { charts, chartVersions } from "../db/schema/charts";
import type { FileReference } from "../storage/references";

async function retained(db: Parameters<FileReference["references"]>[0], fileId: string) {
  return (await db.select({ id: chartVersions.id }).from(chartVersions)
    .innerJoin(charts, eq(charts.id, chartVersions.chartId))
    .where(and(eq(chartVersions.sourceFileId, fileId), isNull(chartVersions.deletedAt), isNull(charts.deletedAt)))
    .limit(1)).length > 0;
}

/** Private drafts and all undeleted history retain their source through account cooling-off. */
export const chartFileReference: FileReference = {
  name: "chart-version", referenceTable: chartVersions, deletionPartner: "charts",
  references: retained, retention: retained,
  publicRepresentations: async () => false,
  unreferenced: sql`not exists(select 1 from ${chartVersions} v join ${charts} ch on ch.id=v.chart_id
    where v.source_file_id=${files.id} and v.deleted_at is null and ch.deleted_at is null)`,
};
