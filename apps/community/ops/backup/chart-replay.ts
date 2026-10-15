import type { Client } from "pg";
import { permissionFact, retentionFact } from "../../src/shared/chart-journal";
import type { JournalRecord } from "./journal";
export type ChartRestorePending = {
  code: "CHART_PUBLICATION_RESTORE_PENDING";
  chartId: string;
  versionId: string;
};
type ReportPending = (diagnostic: ChartRestorePending) => void;
/** A missing authorized version closes access; never choose another private version. */
export async function replayChartPermission(
  c: Client,
  r: JournalRecord,
  payload: unknown,
  reportPending?: ReportPending,
) {
  const p = permissionFact.parse(payload);
  const chart = await c.query("select publication_sequence from charts where id=$1 for update", [
    p.chartId,
  ]);
  const pending = () => {
    if (p.publication)
      reportPending?.({
        code: "CHART_PUBLICATION_RESTORE_PENDING",
        chartId: p.chartId,
        versionId: p.publication.versionId,
      });
  };
  if (!chart.rowCount) {
    pending();
    return;
  }
  if (Number(chart.rows[0].publication_sequence) > r.sequence) return;
  await c.query("delete from chart_publications where chart_id=$1", [p.chartId]);
  await c.query(
    "update charts set publication_sequence=$2,revision=greatest(revision,$3) where id=$1",
    [p.chartId, r.sequence, p.revision],
  );
  if (!p.publication) return;
  const s = p.publication;
  const restored = await c.query(
    `insert into chart_publications(chart_id,version_id,title,artist,published_at,updated_at)
 select ch.id,v.id,$3,$4,$5,$6 from charts ch join chart_versions v on v.chart_id=ch.id
 join files f on f.id=v.source_file_id join blobs b on b.id=f.blob_id
 join blob_derivatives d on d.id=v.preview_derivative_id and d.source_blob_id=b.id
 join derived_objects o on o.id=d.derived_object_id
 where ch.id=$1 and v.id=$2 and ch.deleted_at is null and v.deleted_at is null
 and f.state='ready' and f.deleted_at is null and f.purpose='chart-source' and b.state='ready'
 and d.state='ready' and d.recipe='chart-preview-v1' and o.state='ready'
 and not exists(select 1 from blob_blocks where sha256 in(b.sha256,o.output_sha256))`,
    [p.chartId, s.versionId, s.title, s.artist, s.publishedAt, s.updatedAt],
  );
  if (!restored.rowCount) pending();
}
export async function replayDeletedUserCharts(
  c: Client,
  r: JournalRecord,
  reportPending?: ReportPending,
) {
  const retained = r.payload ? retentionFact.parse(r.payload).retained : [];

  for (const fact of retained) {
    // Only this historical owner's association can become anonymous. Later unrelated ownership never qualifies.
    const owns = await c.query(
      "select 1 from charts where id=$1 and (owner_id=$2 or owner_id is null)",
      [fact.chartId, r.userId],
    );
    if (!owns.rowCount) {
      reportPending?.({
        code: "CHART_PUBLICATION_RESTORE_PENDING",
        chartId: fact.chartId,
        versionId: fact.publication.versionId,
      });
      continue;
    }
    await replayChartPermission(c, r, fact, reportPending);
    const p = await c.query(
      "select version_id from chart_publications where chart_id=$1 and version_id=$2",
      [fact.chartId, fact.publication.versionId],
    );
    if (!p.rowCount) continue;

    await c.query(
      "update charts set current_version_id=$2,title=$3,artist=$4,owner_id=null where id=$1",
      [fact.chartId, fact.publication.versionId, fact.publication.title, fact.publication.artist],
    );
    await c.query("delete from chart_versions where chart_id=$1 and id<>$2", [
      fact.chartId,
      fact.publication.versionId,
    ]);
    await c.query(
      "update files set owner_id=null,original_name='removed' where id in(select source_file_id from chart_versions where chart_id=$1)",
      [fact.chartId],
    );
  }
  await c.query(
    "delete from chart_publications where chart_id in(select id from charts where owner_id=$1)",
    [r.userId],
  );
  await c.query("update charts set current_version_id=null where owner_id=$1", [r.userId]);
  await c.query(
    "delete from chart_versions where chart_id in(select id from charts where owner_id=$1)",
    [r.userId],
  );
  await c.query("delete from charts where owner_id=$1", [r.userId]);
  // Even missing retained versions cannot restore the user's other files or identity.
  await c.query(
    "update files set state='deleted',deleted_at=coalesce(deleted_at,$2),retained_until=$2::timestamptz+interval '30 days',original_name='removed' where owner_id=$1 and state<>'deleted'",
    [r.userId, r.createdAt],
  );
}
