import {discoveryStatus} from "../discovery/catalog";
import {libraryStatus} from "../library/moderation";
import { followingStatus } from "../following/notifications";
import { eq, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DashChart, DashChartsPage, DashModerateInput, DashOverview, DashStatus, DashUsersPage } from "@/shared/dash";
import { isPublicChartId } from "@/shared/chart-public-id";
import { charts, chartModerations, chartPublications, chartPublicIds, storageJournalProgress, userPublicIds, user } from "../db/schema";
import type { Db } from "../db/client";
import type { StorageContext } from "../storage/contracts";
import { StorageError } from "../storage/errors";
import { withStorageTransaction } from "../storage/transactions";
import { lockUploadAccounting, storageTime } from "../storage/usage";
import { publicationDto } from "../charts/service";
import { recordPermission, awaitChartJournal } from "../charts/publication-journal";
import { UUID_PATTERN } from "../uuid";
import { withTimeout } from "../with-timeout";
import { unknownNapcatObservation } from "../napcat/health";
import type { ApiServices } from "./api-services";

/** Reads durable identity and current account state; session/frontend flags grant no authority. */
export async function dashAccess(services: ApiServices, userId: string): Promise<{ publicId: string } | null> {
  if (!services.adminPublicIds?.length) return null;
  const [r] = await services.db.select({ publicId: userPublicIds.publicId }).from(userPublicIds)
    .innerJoin(user, eq(user.id, userPublicIds.userId))
    .innerJoin(storageJournalProgress, eq(storageJournalProgress.id, "global"))
    .where(sql`${user.id}=${userId} and ${user.status}='active' and ${userPublicIds.journalSequence}<=${storageJournalProgress.exportedSequence}`);
  const publicId = r?.publicId.toString();
  return publicId && services.adminPublicIds.includes(publicId) ? { publicId } : null;
}

/** Keep observational SQL bounded on the actual DB, including lock waits. */
async function read<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  return db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='2s'`);
    await tx.execute(sql`set local lock_timeout='1s'`);
    return (await tx.execute(query)).rows as T[];
  });
}
export function dashPage(query: { cursor?: string; limit?: string }) {
  const limit = query.limit === undefined ? 24 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    (query.cursor !== undefined && !isPublicChartId(query.cursor)))
    throw new HTTPException(400, { message: "Invalid page" });
  return { limit, cursor: query.cursor ?? "0" };
}
export async function dashOverview(db: Db): Promise<DashOverview> {
  const [r] = await read<Omit<DashOverview, "capturedAt">>(db, sql`select
    (select count(*)::float8 from "user") as users,
    (select count(*)::float8 from "user" where status='active') as "activeUsers",
    (select count(*)::float8 from "user" where status='pending_deletion') as "pendingDeletionUsers",
    (select count(*)::float8 from chart_publications p join charts c on c.id=p.chart_id left join "user" u on u.id=c.owner_id
      where c.deleted_at is null and (c.owner_id is null or u.status='active')
      and c.publication_sequence<=coalesce((select exported_sequence from storage_journal_progress where id='global'),0)
      and not exists(select 1 from chart_moderations m where m.chart_id=p.chart_id)) as "publicCharts",
    (select count(*)::float8 from chart_moderations) as "moderatedCharts",
    (select count(*)::float8 from upload_sessions where state in ('receiving','processing')) as "activeUploads",
    coalesce((select original_written::float8 from storage_budget where id='global'),0) as "originalBytes",
    coalesce((select derived_written::float8 from storage_budget where id='global'),0) as "derivedBytes"`);
  return { ...r, capturedAt: new Date().toISOString() };
}
export async function dashUsers(db: Db, page: ReturnType<typeof dashPage>): Promise<DashUsersPage> {
  const rows = await read<DashUsersPage["items"][number]>(db, sql`select i.public_id::text as "publicId",u.name,u.image,u.status,
    to_char(u.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
    (select count(*)::float8 from charts c where c.owner_id=u.id and c.deleted_at is null) as charts,
    (select count(*)::float8 from charts c join chart_publications p on p.chart_id=c.id
      where c.owner_id=u.id and c.deleted_at is null and u.status='active'
      and c.publication_sequence<=coalesce((select exported_sequence from storage_journal_progress where id='global'),0)
      and not exists(select 1 from chart_moderations m where m.chart_id=c.id)) as "publicCharts"
    from user_public_ids i join "user" u on u.id=i.user_id
    where i.public_id>${page.cursor}::bigint and i.journal_sequence<=coalesce((select exported_sequence from storage_journal_progress where id='global'),0)
    order by i.public_id limit ${page.limit + 1}`);
  return { items: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? rows[page.limit - 1].publicId : null };
}
const chartColumns = sql`i.chart_id as id,i.public_id::text as "publicId",coalesce(c.revision,m.revision) as revision,
  case when m.chart_id is not null then m.publication->>'title' else p.title end as title,
  case when m.chart_id is not null then m.publication->>'artist' else p.artist end as artist,
  case when m.chart_id is not null then m.author
    when ui.public_id is not null and ui.journal_sequence<=coalesce(j.exported_sequence,0) then jsonb_build_object('publicId',ui.public_id::text,'name',u.name) else null end as author,
  case when m.chart_id is not null then m.publication->>'publishedAt'
    else to_char(p.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as "publishedAt",
  case when m.chart_id is not null then 'moderated' else 'public' end as status,
  case when m.chart_id is not null then jsonb_build_object('reason',m.reason,'actorPublicId',m.actor_public_id::text,
    'createdAt',to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) else null end as moderation,
  greatest(coalesce(c.publication_sequence,0),coalesce(m.journal_sequence,0))>coalesce(j.exported_sequence,0) as pending`;
const chartFrom = sql`from chart_public_ids i left join charts c on c.id=i.chart_id
  left join chart_publications p on p.chart_id=i.chart_id left join chart_moderations m on m.chart_id=i.chart_id
  left join "user" u on u.id=c.owner_id left join user_public_ids ui on ui.user_id=u.id
  left join storage_journal_progress j on j.id='global'`;
const visibleChart = sql`(m.chart_id is not null or (p.chart_id is not null and c.deleted_at is null and c.publication_sequence<=coalesce(j.exported_sequence,0) and (c.owner_id is null or u.status='active')))`;
export async function dashChartsByIds(db: Db, ids: readonly string[]): Promise<DashChart[]> {
  if (ids.length > 50 || ids.some(id => !UUID_PATTERN.test(id))) throw new HTTPException(400);
  if (!ids.length) return [];
  return read<DashChart>(db, sql`select ${chartColumns} ${chartFrom} where i.chart_id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)}) and ${visibleChart}`);
}
export async function dashCharts(db: Db, page: ReturnType<typeof dashPage>): Promise<DashChartsPage> {
  const rows = await read<DashChart>(db, sql`select ${chartColumns} ${chartFrom}
    where i.public_id>${page.cursor}::bigint and ${visibleChart} order by i.public_id limit ${page.limit + 1}`);
  return { items: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? rows[page.limit - 1].publicId : null };
}
async function dashChart(db: Db, id: string): Promise<DashChart> {
  const [row] = await read<DashChart>(db, sql`select ${chartColumns} ${chartFrom} where i.chart_id=${id}::uuid and ${visibleChart}`);
  if (!row) throw new StorageError(404, "NOT_FOUND");
  return row;
}
export async function moderateChart(ctx: StorageContext, actor: { id: string; publicId: string }, id: string, input: DashModerateInput): Promise<DashChart> {
  if (!UUID_PATTERN.test(id)) throw new StorageError(404, "NOT_FOUND");
  const reason = input.reason.trim();
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision > 2147483647 ||
    [...reason].length < 1 || [...reason].length > 500)
    throw new HTTPException(400, { message: "Invalid moderation request" });
  id = id.toLowerCase();
  const sequence = await withStorageTransaction(ctx.db, async tx => {
    await tx.execute(sql`select set_config('adxc.governance_actor',${actor.id},true)`);
    // Immutable retries still recover after the former author's account becomes inactive.
    const [previous] = await tx.select().from(chartModerations).where(eq(chartModerations.chartId, id));
    if (previous) return previous.journalSequence;
    // Same owner-before-chart lock order as publishing, deletion and edits.
    const [candidate] = await tx.select({ ownerId: charts.ownerId }).from(charts).where(eq(charts.id, id));
    if (candidate?.ownerId) await lockUploadAccounting(tx, candidate.ownerId);
    const [chart] = await tx.select().from(charts).where(eq(charts.id, id)).for("update");
    const [existing] = await tx.select().from(chartModerations).where(eq(chartModerations.chartId, id));
    // A retry may only wait for the first decision; its new reason/revision never replaces it.
    if (existing) return existing.journalSequence;
    if (!chart || chart.deletedAt) throw new StorageError(404, "NOT_FOUND");
    if (chart.revision !== input.expectedRevision || chart.revision >= 2147483647) throw new StorageError(409, "CHART_CHANGED");
    const [publication] = await tx.select().from(chartPublications).where(eq(chartPublications.chartId, id));
    const [identity] = await tx.select().from(chartPublicIds).where(eq(chartPublicIds.chartId, id));
    const [progress] = await tx.select().from(storageJournalProgress).where(eq(storageJournalProgress.id, "global"));
    if (!publication || !identity || chart.publicationSequence > (progress?.exportedSequence ?? 0))
      throw new StorageError(409, "CHART_CHANGED");
    const [author] = chart.ownerId ? await tx.select({ publicId: userPublicIds.publicId, name: user.name })
      .from(userPublicIds).innerJoin(user, eq(user.id, userPublicIds.userId))
      .where(sql`${user.id}=${chart.ownerId} and ${user.status}='active' and ${userPublicIds.journalSequence}<=${progress?.exportedSequence ?? 0}`) : [];
    if (chart.ownerId && !author) throw new StorageError(409, "CHART_CHANGED");
    const now = await storageTime(tx);
    await tx.insert(chartModerations).values({ chartId: id, publicId: identity.publicId, revision: chart.revision + 1,
      actorId: actor.id, actorPublicId: BigInt(actor.publicId), reason,
      publication: publicationDto(publication), author: author ? { publicId: author.publicId.toString(), name: author.name } : null, createdAt: now });
    await tx.delete(chartPublications).where(eq(chartPublications.chartId, id));
    const sequence = await recordPermission(tx, id, chart.revision + 1, null, now);
    await tx.update(chartModerations).set({ journalSequence: sequence }).where(eq(chartModerations.chartId, id));
    await tx.update(charts).set({ revision: chart.revision + 1, publicationSequence: sequence, updatedAt: now }).where(eq(charts.id, id));
    return sequence;
  });
  await awaitChartJournal(ctx, sequence);
  return dashChart(ctx.db, id);
}

export async function dashStatus(services: ApiServices): Promise<DashStatus> {
  const checks = await Promise.all(Object.entries(services.dashChecks ?? {}).map(async ([name, check]) => {
    try { await withTimeout(check(), 2000); return { name, status: "ok" as const }; }
    catch { return { name, status: "unavailable" as const }; }
  }));
  const roles = await read<DashStatus["roles"][number]>(services.db, sql`select expected.role,
    case when r.role is null then -1 else greatest(0,extract(epoch from clock_timestamp()-r.heartbeat_at)) end::float8 as "heartbeatAgeSeconds",
    coalesce(r.heartbeat_at>clock_timestamp()-interval '3 seconds' and r.pause_owner is null
    and exists(select 1 from pg_locks l where l.pid=r.backend_pid and l.locktype='advisory' and l.granted
      and l.objid=case expected.role when 'web' then 714102031 when 'media' then 714102032 when 'control' then 714102033 end),false) as ready
    from (values ('web'),('media'),('control')) as expected(role)
    left join storage_runtime_roles r on r.role=expected.role order by expected.role`);
  const [counts] = await read<{ purgeIncomplete: number; revoking: number; pending: number; active: boolean }>(services.db, sql`select
    (select count(*)::float8 from media_purge_requests where state in ('pending','running','failed')) as "purgeIncomplete",
    (select count(*)::float8 from media_publications where state='revoking') as revoking,
    (select count(*)::float8 from storage_tombstones where sequence>coalesce((select exported_sequence from storage_journal_progress where id='global'),0)) as pending,
    exists(select 1 from storage_maintenance where id='global' and lease_until>clock_timestamp()) as active`);
  let storageDead: number | null = null, mediaPurgeDead: number | null = null;
  try {
    const [queues] = await read<{ storageDead: number; mediaPurgeDead: number }>(services.db, sql`select
      (select count(*)::float8 from pgboss.job where name='storage.dead') as "storageDead",
      (select count(*)::float8 from pgboss.job where name='media.purge.dead') as "mediaPurgeDead"`);
    storageDead = queues.storageDead; mediaPurgeDead = queues.mediaPurgeDead;
  } catch { /* Unknown queue evidence is distinct from an empty queue. */ }
  const [journal] = await read<{ exportedSequence: string; exportedAt: string | null }>(services.db, sql`select exported_sequence::text as "exportedSequence",
    to_char(exported_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "exportedAt" from storage_journal_progress where id='global'`);
  const [backup] = await read<DashStatus["backup"]>(services.db, sql`select case when status='running' and started_at<clock_timestamp()-interval '30 minutes' then 'unknown' else status end as status,
    to_char(started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "startedAt",
    to_char(finished_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "finishedAt",
    to_char(last_success_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "lastSuccessAt",
    manifest_sha256 as "manifestSha256",original_count as "originalCount",bytes::float8 as bytes from storage_backup_status where id='global'`);
  let qq = unknownNapcatObservation();
  try { if (services.napcatObservation) qq = await withTimeout(services.napcatObservation(), 250); }
  catch { /* Missing Redis evidence is unknown, never an offline claim. */ }
  return { capturedAt: new Date().toISOString(), qq, checks, roles, discovery:services.storage?await discoveryStatus(services.storage).catch(()=>null):null, library:services.storage?await libraryStatus(services.storage):null, following:await followingStatus(services),
    queues: { storageDead, mediaPurgeDead, purgeIncomplete: counts.purgeIncomplete, revoking: counts.revoking },
    journal: { exportedSequence: journal?.exportedSequence ?? "0", exportedAt: journal?.exportedAt ?? null, pending: counts.pending },
    maintenance: { active: counts.active },
    backup: backup ?? { status: "unknown", startedAt: null, finishedAt: null, lastSuccessAt: null, manifestSha256: null, originalCount: null, bytes: null } };
}
