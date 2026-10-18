import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { REPORT_CATEGORIES, REPORT_DAILY_LIMIT, REPORT_OPEN_LIMIT, REPORT_TEXT_MAX, type DashReportsPage, type MyReport, type MyReportsPage, type ReportInput, type ReportResolutionInput, type ReportResolutionResult } from "@/shared/community-social";
import { isPublicChartId } from "@/shared/chart-public-id";
import { isPublicUserId } from "@/shared/user-public-id";
import { chartReports, chartModerations, chartPublications, storageJournalProgress, userPublicIds } from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import { StorageError } from "../storage/errors";
import { UUID_PATTERN } from "../uuid";
import { getPublicChart, getPublicChartsByIds } from "../charts/publication";
import { dashChartsByIds } from "./dash";
import { requireActiveSocialUser, socialPage, withSocialUser, type SocialPageInput } from "./social-page";
type ReportRow = typeof chartReports.$inferSelect;
export function reportText(value: string): string {
  const text = value.trim();
  if (text.length > REPORT_TEXT_MAX * 2 || [...text].length < 1 || [...text].length > REPORT_TEXT_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new HTTPException(400, { message: "Invalid report text" });
  return text;
}
function common(row: ReportRow) {
  return { id: row.id, publicId: row.publicId.toString(), versionId: row.versionId, category: row.category, details: row.details,
    status: row.status, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null, resolutionNote: row.resolutionNote };
}
async function ownDtos(ctx: StorageContext, rows: ReportRow[]): Promise<MyReport[]> {
  const visible = new Map((await getPublicChartsByIds(ctx, rows.map(row => row.chartId))).map(chart => [chart.id, chart]));
  return rows.map(row => ({ ...common(row), chart: visible.get(row.chartId) ?? null }));
}
export async function createChartReport(ctx: StorageContext, reporterId: string, id: string, input: ReportInput): Promise<MyReport> {
  if (!isPublicChartId(id) || !UUID_PATTERN.test(input.versionId) || !REPORT_CATEGORIES.includes(input.category)) throw new HTTPException(400);
  const details = reportText(input.details), publicId = BigInt(id);
  await requireActiveSocialUser(ctx.db, reporterId);
  const duplicate = and(eq(chartReports.reporterId, reporterId), eq(chartReports.publicId, publicId), eq(chartReports.versionId, input.versionId.toLowerCase()));
  const [previous] = await ctx.db.select().from(chartReports).where(duplicate);
  // An uncertain submission can be recovered after withdrawal; only the reporter sees their existing ticket.
  if (previous) return (await ownDtos(ctx, [previous]))[0]!;
  const chart = await getPublicChart(ctx, id);
  if (chart.versionId !== input.versionId.toLowerCase()) throw new StorageError(409, "REPORT_CHANGED");
  const record = await withSocialUser(ctx.db, reporterId, async tx => {
    const [existing] = await tx.select().from(chartReports).where(duplicate);
    if (existing) return existing;
    const [published] = await tx.select({ versionId: chartPublications.versionId }).from(chartPublications).where(eq(chartPublications.chartId, chart.id));
    if (published?.versionId !== chart.versionId) throw new StorageError(409, "REPORT_CHANGED");
    const [count] = await tx.select({ daily: sql<number>`(count(*) filter(where ${chartReports.createdAt}>clock_timestamp()-interval '24 hours')+(select count(*) from discussion_reports dr where dr.reporter_id=${reporterId} and dr.created_at>clock_timestamp()-interval '24 hours'))::int`,
      open: sql<number>`(count(*) filter(where ${chartReports.status}='open')+(select count(*) from discussion_reports dr where dr.reporter_id=${reporterId} and dr.status='open'))::int` }).from(chartReports).where(eq(chartReports.reporterId, reporterId));
    if (count.daily >= REPORT_DAILY_LIMIT || count.open >= REPORT_OPEN_LIMIT) throw new StorageError(429, "REPORT_LIMIT", "REPORT_LIMIT", 3600);
    const [saved] = await tx.insert(chartReports).values({ reporterId, chartId: chart.id, publicId, versionId: chart.versionId,
      title: chart.title, artist: chart.artist, category: input.category, details }).returning();
    return saved;
  });
  return (await ownDtos(ctx, [record]))[0]!;
}
export async function listMyReports(ctx: StorageContext, userId: string, input: SocialPageInput = {}): Promise<MyReportsPage> {
  await requireActiveSocialUser(ctx.db, userId);
  const p = socialPage(input, `reports:${userId}`), t = chartReports;
  const rows = await ctx.db.select().from(t).where(and(eq(t.reporterId, userId), p.cursor ? or(lt(t.createdAt, new Date(p.cursor.at)), and(eq(t.createdAt, new Date(p.cursor.at)), lt(t.id, p.cursor.id))) : undefined))
    .orderBy(desc(t.createdAt), desc(t.id)).limit(p.limit + 1);
  const page = rows.slice(0, p.limit), last = page.at(-1);
  return { items: await ownDtos(ctx, page), nextCursor: rows.length > p.limit && last ? p.encode(last.createdAt, last.id) : null };
}
export type ReportFilter = "open" | "resolved" | "all";
export function reportFilter(value?: string): ReportFilter {
  if (value === undefined || value === "open") return "open";
  if (value === "resolved" || value === "all") return value;
  throw new HTTPException(400);
}
export async function listDashReports(ctx: StorageContext, filter: ReportFilter, input: SocialPageInput = {}): Promise<DashReportsPage> {
  const p = socialPage(input, `dash-reports:${filter}`), t = chartReports;
  const rows = await ctx.db.select({ row: t, reporterPublicId: sql<bigint | null>`case when ${userPublicIds.journalSequence}<=(select exported_sequence from storage_journal_progress where id='global') then ${userPublicIds.publicId} else null end` })
    .from(t).leftJoin(userPublicIds, eq(userPublicIds.userId, t.reporterId))
    .where(and(filter === "open" ? eq(t.status, "open") : filter === "resolved" ? sql`${t.status}<>'open'` : undefined,
      p.cursor ? or(lt(t.createdAt, new Date(p.cursor.at)), and(eq(t.createdAt, new Date(p.cursor.at)), lt(t.id, p.cursor.id))) : undefined))
    .orderBy(desc(t.createdAt), desc(t.id)).limit(p.limit + 1);
  const page = rows.slice(0, p.limit), last = page.at(-1);
  const charts = new Map((await dashChartsByIds(ctx.db, page.map(r => r.row.chartId))).map(chart => [chart.id, chart]));
  return { items: page.map(({ row, reporterPublicId }) => ({ ...common(row), title: row.title, artist: row.artist,
    reporterPublicId: reporterPublicId?.toString() ?? null, resolverPublicId: row.resolverPublicId?.toString() ?? null, chart: charts.get(row.chartId) ?? null })),
    nextCursor: rows.length > p.limit && last ? p.encode(last.row.createdAt, last.row.id) : null };
}
export async function resolveChartReport(ctx: StorageContext, actor: { id: string; publicId: string }, id: string, input: ReportResolutionInput): Promise<ReportResolutionResult> {
  if (!UUID_PATTERN.test(id) || !isPublicUserId(actor.publicId) || !["dismissed", "actioned"].includes(input.status)) throw new HTTPException(400);
  const note = reportText(input.note);
  const row = await withSocialUser(ctx.db, actor.id, async tx => {
    const [report] = await tx.select().from(chartReports).where(eq(chartReports.id, id.toLowerCase())).for("update");
    if (!report) throw new StorageError(404, "NOT_FOUND");
    if (report.status !== "open") return report;
    if (input.status === "actioned") {
      const [moderation] = await tx.select({ sequence: chartModerations.journalSequence, exported: storageJournalProgress.exportedSequence })
        .from(chartModerations).leftJoin(storageJournalProgress, eq(storageJournalProgress.id, "global")).where(eq(chartModerations.chartId, report.chartId));
      if (!moderation || moderation.sequence > (moderation.exported ?? 0)) throw new StorageError(409, "REPORT_MODERATION_REQUIRED");
    }
    const [saved] = await tx.update(chartReports).set({ status: input.status, resolutionNote: note, resolverPublicId: BigInt(actor.publicId), resolvedAt: sql`clock_timestamp()` })
      .where(eq(chartReports.id, report.id)).returning();
    return saved;
  });
  return { id: row.id, status: row.status, note: row.resolutionNote };
}
