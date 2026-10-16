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
  await reservePublicChartId(c, p.chartId, p.publicId);
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
    await reservePublicChartId(c, fact.chartId, fact.publicId);
    // A backup predating the selected version still needs a stable anonymous recovery anchor.
    await c.query(
      `insert into charts(id,owner_id,title,artist,revision,publication_sequence)
       values($1,null,$2,$3,$4,$5) on conflict(id) do nothing`,
      [fact.chartId, fact.publication.title, fact.publication.artist, fact.revision, r.sequence],
    );
    const chart = await c.query(
      "select owner_id,publication_sequence from charts where id=$1 for update",
      [fact.chartId],
    );
    const row = chart.rows[0];
    // Never overwrite a later permission or adopt another owner's historical association.
    if (
      (row.owner_id !== null && row.owner_id !== r.userId) ||
      Number(row.publication_sequence) > r.sequence
    )
      continue;
    const version = await c.query("select id from chart_versions where chart_id=$1 and id=$2", [
      fact.chartId,
      fact.publication.versionId,
    ]);
    // Retention does not depend on derived bytes being ready. Keep the exact version/source
    // reference so rebuild and a replay of this fact can reopen it; all other history is private.
    await c.query(
      "update charts set current_version_id=$2,title=$3,artist=$4,owner_id=null where id=$1",
      [
        fact.chartId,
        version.rowCount ? fact.publication.versionId : null,
        fact.publication.title,
        fact.publication.artist,
      ],
    );
    await c.query("delete from chart_publications where chart_id=$1", [fact.chartId]);
    await c.query("delete from chart_versions where chart_id=$1 and id<>$2", [
      fact.chartId,
      fact.publication.versionId,
    ]);
    await c.query(
      "update files set owner_id=null,original_name='removed' where (owner_id=$2 or owner_id is null) and id in(select source_file_id from chart_versions where chart_id=$1)",
      [fact.chartId, r.userId],
    );
    await replayChartPermission(c, r, fact, reportPending);
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

/** Restore runs offline under its advisory lock. A missing chart still consumes its permanent URL. */
async function reservePublicChartId(c: Client, chartId: string, publicId?: string) {
  if (!publicId) return; // Legacy facts never overwrite an allocated identity.
  const current = await c.query("select public_id::text as id from chart_public_ids where chart_id=$1", [chartId]);
  if (current.rowCount && current.rows[0].id !== publicId) throw new Error("CHART_PUBLIC_ID_CONFLICT");
  if (!current.rowCount)
    await c.query("insert into chart_public_ids(chart_id,public_id) overriding system value values($1,$2)", [chartId, publicId]);
  // Never lower a restored sequence, including unused values consumed by rolled-back publications.
  await c.query(`select setval('chart_public_ids_public_id_seq',
    greatest((select last_value from chart_public_ids_public_id_seq),$1::bigint),true)`, [publicId]);
}

/** Called inside the closed restore replay transaction, after the final durable permission state. */
export async function numberRestoredPublications(c: Client, durableSequence: number) {
  const pending = await c.query(`select ch.id from chart_publications p join charts ch on ch.id=p.chart_id
    left join chart_public_ids i on i.chart_id=ch.id
    where i.chart_id is null and ch.publication_sequence <= $1 and ch.deleted_at is null
    order by p.published_at,ch.id for update of ch`, [durableSequence]);
  // Do not publish any unverified snapshot outbox as a side effect of assigning restored URLs.
  if ((await c.query("select 1 from storage_tombstones where sequence>$1 and ($2::boolean or (kind='chart_permission' and payload ? 'publicId')) limit 1", [durableSequence, !!pending.rowCount])).rowCount)
    throw new Error("STORAGE_RESTORE_CLOSED");
  if (!pending.rowCount) return;
  for (const row of pending.rows) {
    const identity = await c.query("insert into chart_public_ids(chart_id) values($1) returning public_id::text as id", [row.id]);
    const state = await c.query(`select ch.revision,p.* from chart_publications p join charts ch on ch.id=p.chart_id where ch.id=$1`, [row.id]);
    const p = state.rows[0];
    const payload = permissionFact.parse({ version: 1, chartId: row.id, publicId: identity.rows[0].id, revision: p.revision,
      publication: { versionId: p.version_id, title: p.title, artist: p.artist, publishedAt: p.published_at.toISOString(), updatedAt: p.updated_at.toISOString() } });
    const fact = await c.query("insert into storage_tombstones(kind,payload) values('chart_permission',$1) returning sequence", [JSON.stringify(payload)]);
    await c.query("update charts set publication_sequence=$2 where id=$1", [row.id, fact.rows[0].sequence]);
  }
}
