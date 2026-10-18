import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ReportCategory, ReportStatus } from "@/shared/community-social";
import { user } from "./auth";
const tz = { withTimezone: true } as const;
// No chart FK: an unavailable bookmark keeps only its number and remains removable by its owner.
export const chartFavorites = pgTable("chart_favorites", {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  chartId: uuid().notNull(), publicId: bigint({ mode: "bigint" }).notNull(),
  createdAt: timestamp(tz).notNull().defaultNow(),
}, t => [
  uniqueIndex("chart_favorites_user_chart_uidx").on(t.userId, t.chartId),
  index("chart_favorites_user_created_idx").on(t.userId, t.createdAt, t.id),
  check("chart_favorites_public_id_check", sql`${t.publicId}>0`),
]);
// Only previously public text is snapshotted. Reporter-owned private tickets cascade on account purge;
// durable takedown decisions remain independently retained in chart_moderations and its journal.
export const chartReports = pgTable("chart_reports", {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  reporterId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  chartId: uuid().notNull(), publicId: bigint({ mode: "bigint" }).notNull(), versionId: uuid().notNull(),
  title: text().notNull(), artist: text().notNull(),
  category: text().$type<ReportCategory>().notNull(), details: text().notNull(),
  status: text().$type<ReportStatus>().notNull().default("open"),
  createdAt: timestamp(tz).notNull().defaultNow(), resolvedAt: timestamp(tz),
  resolutionNote: text(), resolverPublicId: bigint({ mode: "bigint" }),
}, t => [
  uniqueIndex("chart_reports_reporter_version_uidx").on(t.reporterId, t.chartId, t.versionId),
  index("chart_reports_reporter_created_idx").on(t.reporterId, t.createdAt, t.id),
  index("chart_reports_status_created_idx").on(t.status, t.createdAt, t.id),
  check("chart_reports_public_id_check", sql`${t.publicId}>0`),
  check("chart_reports_category_check", sql`${t.category} in ('copyright','inappropriate','broken','other')`),
  check("chart_reports_details_check", sql`char_length(${t.details}) between 1 and 500`),
  check("chart_reports_status_check", sql`${t.status} in ('open','dismissed','actioned')`),
  check("chart_reports_resolution_check", sql`(${t.status}='open' and ${t.resolvedAt} is null and ${t.resolutionNote} is null and ${t.resolverPublicId} is null) or (${t.status}<>'open' and ${t.resolvedAt} is not null and char_length(${t.resolutionNote}) between 1 and 500 and ${t.resolutionNote} is not null and ${t.resolverPublicId}>0 and ${t.resolverPublicId} is not null)`),
]);
