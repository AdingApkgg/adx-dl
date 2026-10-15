import { recordPermission } from "./publication-journal";
import { and, eq, isNull, ne } from "drizzle-orm";
import { charts, chartVersions, chartPublications } from "../db/schema/charts";
import type { DeletionHandler } from "../services/user-deletion";
import { storageTime } from "../storage/usage";
import { lockDeletionAccounting } from "../storage/deletion";
/** User status gates cooling-off reads; final retention keeps exactly the selected publication. */
export const chartDeletionHandler: DeletionHandler = {
  name: "charts",
  async hasContent(userId, db) {
    return (
      (
        await db
          .select({ id: charts.id })
          .from(charts)
          .where(and(eq(charts.ownerId, userId), isNull(charts.deletedAt)))
          .limit(1)
      ).length > 0
    );
  },
  async purge(userId, options, tx) {
    await lockDeletionAccounting(tx, userId);
    const now = await storageTime(tx);
    const owned = await tx
      .select()
      .from(charts)
      .where(eq(charts.ownerId, userId))
      .orderBy(charts.id)
      .for("update");
    for (const chart of owned) {
      const [p] = await tx
        .select()
        .from(chartPublications)
        .where(eq(chartPublications.chartId, chart.id));
      if (!options.deleteContent && p && !chart.deletedAt) {
        await tx
          .update(charts)
          .set({ currentVersionId: p.versionId, title: p.title, artist: p.artist, updatedAt: now })
          .where(eq(charts.id, chart.id));
        await tx
          .delete(chartVersions)
          .where(and(eq(chartVersions.chartId, chart.id), ne(chartVersions.id, p.versionId)));
      } else {
        if (p || chart.publicationSequence > 0)
          await recordPermission(
            tx,
            chart.id,
            Math.min(chart.revision + 1, 2147483647),
            null,
            now,
            userId,
          );
        await tx.delete(chartPublications).where(eq(chartPublications.chartId, chart.id));
        await tx.update(charts).set({ currentVersionId: null }).where(eq(charts.id, chart.id));
        await tx.delete(chartVersions).where(eq(chartVersions.chartId, chart.id));
        await tx.delete(charts).where(eq(charts.id, chart.id));
      }
    }
  },
};
