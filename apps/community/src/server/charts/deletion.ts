import { and, eq, isNull } from "drizzle-orm";
import { charts, chartVersions } from "../db/schema/charts";
import type { DeletionHandler } from "../services/user-deletion";
import { storageTime } from "../storage/usage";

/** Drafts remain private during cooling-off; account status gates reads without losing the references. */
export const chartDeletionHandler: DeletionHandler = {
  name: "charts",
  async hasContent(userId, db) {
    return (await db.select({ id: charts.id }).from(charts)
      .where(and(eq(charts.ownerId, userId), isNull(charts.deletedAt))).limit(1)).length > 0;
  },
  async purge(userId, _options, tx) {
    const now = await storageTime(tx);
    const owned = await tx.select({ id: charts.id }).from(charts).where(eq(charts.ownerId, userId)).orderBy(charts.id).for("update");
    // Withdraw every private association before storage's refund/tombstone pass, for either deleteContent choice.
    for (const chart of owned) {
      await tx.update(chartVersions).set({ deletedAt: now }).where(and(eq(chartVersions.chartId, chart.id), isNull(chartVersions.deletedAt)));
      await tx.update(charts).set({ deletedAt: now, updatedAt: now }).where(and(eq(charts.id, chart.id), isNull(charts.deletedAt)));
    }
  },
};
