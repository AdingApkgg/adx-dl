import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ChartImportSummary } from "@/shared/charts";
import { user } from "./auth";
import { blobDerivatives, files } from "./storage";
const tz = { withTimezone: true } as const;

export const charts = pgTable("charts", {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  ownerId: text().references(() => user.id, { onDelete: "set null" }),
  publicationSequence: bigint({ mode: "number" }).notNull().default(0),
  title: text().notNull(),
  artist: text().notNull().default(""),
  // Nullable solely during the atomic chart + first-version insertion.
  currentVersionId: uuid(),
  revision: integer().notNull().default(1),
  createdAt: timestamp(tz).notNull().defaultNow(),
  updatedAt: timestamp(tz).notNull().defaultNow(),
  deletedAt: timestamp(tz),
}, (t) => [
  check("charts_title_check", sql`char_length(${t.title}) between 1 and 120`),
  check("charts_artist_check", sql`char_length(${t.artist}) <= 120`),
  check("charts_revision_check", sql`${t.revision} > 0`),
  index("charts_owner_updated_idx").on(t.ownerId, t.updatedAt, t.id),
  foreignKey({ name: "charts_current_version_fk", columns: [t.id, t.currentVersionId], foreignColumns: [chartVersions.chartId, chartVersions.id] }),
]);

export const chartVersions = pgTable("chart_versions", {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  chartId: uuid().notNull().references((): AnyPgColumn => charts.id, { onDelete: "cascade" }),
  ordinal: integer().notNull(),
  // Deleted metadata keeps its ordinal when the existing 30-day logical File sweep removes the row.
  // The CHECK below forbids a missing source on any live version.
  sourceFileId: uuid().references(() => files.id, { onDelete: "set null" }),
  previewDerivativeId: uuid().notNull().references(() => blobDerivatives.id, { onDelete: "restrict" }),
  maidataMd5Base64: text().notNull(),
  summary: jsonb().$type<ChartImportSummary>().notNull(),
  createdAt: timestamp(tz).notNull().defaultNow(),
  deletedAt: timestamp(tz),
}, (t) => [
  uniqueIndex("chart_versions_source_file_uidx").on(t.sourceFileId),
  uniqueIndex("chart_versions_chart_ordinal_uidx").on(t.chartId, t.ordinal),
  uniqueIndex("chart_versions_chart_id_uidx").on(t.chartId, t.id),
  check("chart_versions_ordinal_check", sql`${t.ordinal} > 0`),
  check("chart_versions_live_source_check", sql`${t.deletedAt} is not null or ${t.sourceFileId} is not null`),
  check("chart_versions_md5_check", sql`${t.maidataMd5Base64} ~ '^[A-Za-z0-9+/]{22}==$'`),
]);

export const chartPublications = pgTable("chart_publications", {
  chartId: uuid().primaryKey().references(() => charts.id, { onDelete: "cascade" }),
  versionId: uuid().notNull(),
  title: text().notNull(),
  artist: text().notNull(),
  publishedAt: timestamp(tz).notNull(),
  updatedAt: timestamp(tz).notNull(),
}, t => [
  foreignKey({ name: "chart_publication_version_fk", columns: [t.chartId, t.versionId], foreignColumns: [chartVersions.chartId, chartVersions.id] }),
  index("chart_publications_updated_idx").on(t.updatedAt, t.chartId),
]);
