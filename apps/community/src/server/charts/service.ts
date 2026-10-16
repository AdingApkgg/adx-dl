import { recordPermission, awaitChartJournal } from "./publication-journal";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ChartDto, ChartImportSummary, ChartListItemDto, ChartsPageDto, ChartVersionDto } from "@/shared/charts";
import { chartPublicIds, blobBlocks, blobDerivatives, blobs, chartPublications, chartVersions, charts, derivedObjects, files, storageJournalProgress, user } from "../db/schema";
import type { DbTransaction, StorageContext } from "../storage/contracts";
import { StorageError } from "../storage/errors";
import { deleteFileInTransaction } from "../storage/files";
import type { ReferenceDb } from "../storage/references";
import { withStorageTransaction } from "../storage/transactions";
import { lockUploadAccounting, storageTime } from "../storage/usage";
import { UUID_PATTERN } from "../uuid";
import { validateChartPreviewManifest } from "./artifact";
import { CHART_PREVIEW_MIME, recipeBuildFor } from "./recipe";
import { chartUploadRule, usageByPurpose } from "./upload-rules";

const notFound = () => new StorageError(404, "NOT_FOUND");
const invalid = () => new HTTPException(400, { message: "Invalid chart request" });
type Chart = typeof charts.$inferSelect;
function requireId(id: string) { if (!UUID_PATTERN.test(id)) throw notFound(); }
function revision(input: number) {
  if (!Number.isSafeInteger(input) || input < 1) throw invalid();
}
function changed(chart: Chart, expected: number) {
  if (chart.revision !== expected) throw new StorageError(409, "CHART_CHANGED");
  if (chart.revision >= 2147483647) throw new StorageError(409, "CHART_CHANGED");
}
export async function ownChart(db: ReferenceDb, userId: string, id: string, includeDeleted = false, lock = false) {
  requireId(id);
  const query = db.select({ chart: charts }).from(charts)
    .innerJoin(user, eq(user.id, charts.ownerId))
    .where(and(eq(charts.id, id), eq(charts.ownerId, userId), eq(user.status, "active"),
      ...(includeDeleted ? [] : [isNull(charts.deletedAt)])));
  const [row] = lock ? await query.for("update", { of: charts }) : await query;
  if (!row) throw notFound();
  return row.chart;
}
async function dto(db: DbTransaction, chart: Chart): Promise<ChartDto> {
  if (!chart.currentVersionId || chart.deletedAt) throw notFound();
  const rows = await db.select({ version: chartVersions, size: files.size }).from(chartVersions)
    .innerJoin(files, eq(files.id, chartVersions.sourceFileId))
    .where(and(eq(chartVersions.chartId, chart.id), isNull(chartVersions.deletedAt)))
    .orderBy(desc(chartVersions.ordinal)).limit(20);
  const versions: ChartVersionDto[] = rows.map(({ version, size }) => ({
    id: version.id, ordinal: version.ordinal, sourceFileId: version.sourceFileId!,
    sourceSize: size, summary: version.summary, createdAt: version.createdAt.toISOString(),
  }));
  if (!versions.some(v => v.id === chart.currentVersionId)) throw notFound();
  const [publication] = await db.select().from(chartPublications).where(eq(chartPublications.chartId, chart.id));
  const [progress] = await db.select().from(storageJournalProgress).where(eq(storageJournalProgress.id, "global"));
  const [identity] = await db.select().from(chartPublicIds).where(eq(chartPublicIds.chartId, chart.id));
  return { publicId: identity?.publicId.toString() ?? null, publicationPending: chart.publicationSequence > (progress?.exportedSequence ?? 0),
    publication: publication ? publicationDto(publication) : null,
    id: chart.id, title: chart.title, artist: chart.artist, revision: chart.revision,
    currentVersionId: chart.currentVersionId, versions, createdAt: chart.createdAt.toISOString(),
    updatedAt: chart.updatedAt.toISOString() };
}

/** All file bindings are checked while holding the same owner/usage locks as upload accounting. */
async function source(tx: DbTransaction, ctx: StorageContext, userId: string, fileId: string) {
  requireId(fileId);
  const [file] = await tx.select().from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerId, userId))).for("update");
  if (!file || file.state === "deleted" || file.deletedAt || file.purpose !== "chart-source") throw notFound();
  if (file.state !== "ready") throw new StorageError(409, "CHART_FILE_NOT_READY");
  const [blob] = await tx.select().from(blobs).where(eq(blobs.id, file.blobId)).for("update");
  if (!blob || blob.state !== "ready" || blob.size !== file.size) throw new StorageError(409, "CHART_FILE_NOT_READY");
  const [recipe] = await tx.select().from(blobDerivatives).where(and(
    eq(blobDerivatives.sourceBlobId, blob.id), eq(blobDerivatives.recipe, "chart-preview-v1"),
    eq(blobDerivatives.recipeBuild, recipeBuildFor(ctx, "chart-source")), eq(blobDerivatives.state, "ready"),
  )).for("update");
  if (!recipe?.derivedObjectId) throw new StorageError(409, "CHART_FILE_NOT_READY");
  const [output] = await tx.select().from(derivedObjects).where(eq(derivedObjects.id, recipe.derivedObjectId)).for("update");
  if (!output || output.state !== "ready" || output.mime !== CHART_PREVIEW_MIME || (await tx.select().from(blobBlocks)
    .where(inArray(blobBlocks.sha256, [blob.sha256, output.outputSha256]))).length)
    throw new StorageError(409, "CHART_FILE_NOT_READY");
  let summary: ChartImportSummary;
  try { summary = validateChartPreviewManifest(output.properties.chartPreview, output.size).summary; }
  catch { throw new StorageError(409, "CHART_FILE_NOT_READY"); }
  return { file, recipe, summary };
}
async function assigned(tx: DbTransaction, fileId: string) {
  requireId(fileId);
  const [row] = await tx.select({ version: chartVersions, chart: charts }).from(chartVersions)
    .innerJoin(charts, eq(charts.id, chartVersions.chartId))
    .where(eq(chartVersions.sourceFileId, fileId));
  return row;
}
export async function createChart(ctx: StorageContext, userId: string, fileId: string): Promise<ChartDto> {
  fileId = fileId.toLowerCase();
  return withStorageTransaction(ctx.db, async tx => {
    await lockUploadAccounting(tx, userId);
    const previous = await assigned(tx, fileId);
    if (previous) {
      if (previous.chart.ownerId !== userId) throw notFound();
      if (previous.chart.deletedAt || previous.version.deletedAt)
        throw new StorageError(409, "CHART_FILE_ASSIGNED");
      return dto(tx, previous.chart);
    }
    const ready = await source(tx, ctx, userId, fileId);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::integer` }).from(charts)
      .where(and(eq(charts.ownerId, userId), isNull(charts.deletedAt)));
    if (count >= 50) throw new StorageError(409, "CHART_DRAFT_LIMIT");
    const now = await storageTime(tx);
    const capped = (value: string) => Array.from(value.trim()).slice(0, 120).join("");
    const fallback = capped(ready.file.originalName.replace(/\.zip$/i, "")) || "Untitled";
    const [chart] = await tx.insert(charts).values({ ownerId: userId,
      title: capped(ready.summary.title) || fallback,
      artist: capped(ready.summary.artist), createdAt: now, updatedAt: now }).returning();
    const [version] = await tx.insert(chartVersions).values({ chartId: chart.id, ordinal: 1,
      sourceFileId: fileId, previewDerivativeId: ready.recipe.id,
      maidataMd5Base64: ready.summary.maidataMd5Base64, summary: ready.summary, createdAt: now }).returning();
    const [saved] = await tx.update(charts).set({ currentVersionId: version.id }).where(eq(charts.id, chart.id)).returning();
    return dto(tx, saved);
  });
}
export async function getChart(ctx: StorageContext, userId: string, id: string): Promise<ChartDto> {
  // Chart revision/sequence, publication and checkpoint must describe one database snapshot.
  return ctx.db.transaction(async tx => dto(tx, await ownChart(tx, userId, id)), {
    isolationLevel: "repeatable read", accessMode: "read only",
  });
}
type Cursor = { at: string; id: string };
function decodeCursor(value: string): Cursor {
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
    const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!c || !UUID_PATTERN.test(c.id) || typeof c.at !== "string" || new Date(c.at).toISOString() !== c.at) throw invalid();
    return c;
  } catch { throw invalid(); }
}
export async function listCharts(ctx: StorageContext, userId: string, input: { cursor?: string; limit?: number } = {}): Promise<ChartsPageDto> {
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw invalid();
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  // Read-only reporting uses a consistent snapshot; quota admission still owns the mutation locks.
  return ctx.db.transaction(async tx => {
  const [owner] = await tx.select({ id: user.id }).from(user).where(and(eq(user.id, userId), eq(user.status, "active")));
  if (!owner) throw new StorageError(403, "ACCOUNT_INACTIVE");
  const rows = await tx.select({ chart: charts, identity: chartPublicIds, publication: chartPublications, summary: chartVersions.summary }).from(charts)
    .leftJoin(chartPublicIds, eq(chartPublicIds.chartId, charts.id))
    .leftJoin(chartPublications, eq(chartPublications.chartId, charts.id))
    .innerJoin(user, eq(user.id, charts.ownerId))
    .innerJoin(chartVersions, and(eq(chartVersions.id, charts.currentVersionId), eq(chartVersions.chartId, charts.id)))
    .where(and(eq(charts.ownerId, userId), eq(user.status, "active"), isNull(charts.deletedAt), isNull(chartVersions.deletedAt),
      ...(cursor ? [or(lt(charts.updatedAt, new Date(cursor.at)), and(eq(charts.updatedAt, new Date(cursor.at)), lt(charts.id, cursor.id)))] : [])))
    .orderBy(desc(charts.updatedAt), desc(charts.id)).limit(limit + 1);
  const [progress] = await tx.select().from(storageJournalProgress).where(eq(storageJournalProgress.id, "global"));
  const page = rows.slice(0, limit);
  const items: ChartListItemDto[] = page.map(({ chart, identity, summary, publication }) => ({
    publicId: identity?.publicId.toString() ?? null,
    publicationPending: chart.publicationSequence > (progress?.exportedSequence ?? 0),
    publication: publication ? publicationDto(publication) : null, id: chart.id,
    title: chart.title, artist: chart.artist, revision: chart.revision, currentVersionId: chart.currentVersionId!,
    summary, updatedAt: chart.updatedAt.toISOString() }));
  const last = page.at(-1)?.chart;
  const usage = await usageByPurpose(tx, userId, "chart-source");
  return { items, nextCursor: rows.length > limit && last
    ? Buffer.from(JSON.stringify({ at: last.updatedAt.toISOString(), id: last.id })).toString("base64url") : null,
    usage: { ...usage, quotaBytes: chartUploadRule.quota } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export type ChartPatch = { expectedRevision: number; title?: string; artist?: string; currentVersionId?: string };
export async function updateChart(ctx: StorageContext, userId: string, id: string, input: ChartPatch): Promise<ChartDto> {
  id = id.toLowerCase();
  revision(input.expectedRevision);
  if (input.title === undefined && input.artist === undefined && input.currentVersionId === undefined) throw invalid();
  const title = input.title?.trim(), artist = input.artist?.trim();
  if ((title !== undefined && (!title || [...title].length > 120)) || (artist !== undefined && [...artist].length > 120)) throw invalid();
  return withStorageTransaction(ctx.db, async tx => {
    await lockUploadAccounting(tx, userId);
    const chart = await ownChart(tx, userId, id, false, true);
    changed(chart, input.expectedRevision);
    if (input.currentVersionId !== undefined) {
      requireId(input.currentVersionId);
      const [version] = await tx.select().from(chartVersions).where(and(eq(chartVersions.id, input.currentVersionId),
        eq(chartVersions.chartId, id), isNull(chartVersions.deletedAt))).for("update");
      if (!version) throw notFound();
      await verifyHistoricalSource(tx, userId, version);
    }
    const now = await storageTime(tx);
    const [saved] = await tx.update(charts).set({ ...(title !== undefined ? { title } : {}),
      ...(artist !== undefined ? { artist } : {}), ...(input.currentVersionId !== undefined ? { currentVersionId: input.currentVersionId } : {}),
      revision: chart.revision + 1, updatedAt: now }).where(eq(charts.id, id)).returning();
    return dto(tx, saved);
  });
}
export async function verifyHistoricalSource(tx: DbTransaction, userId: string, version: typeof chartVersions.$inferSelect) {
  if (!version.sourceFileId) throw new StorageError(409, "CHART_FILE_NOT_READY");
  const [row] = await tx.select({ file: files, blob: blobs, recipe: blobDerivatives, output: derivedObjects }).from(files)
    .innerJoin(blobs, eq(blobs.id, files.blobId))
    .innerJoin(blobDerivatives, eq(blobDerivatives.id, version.previewDerivativeId))
    .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId))
    .where(and(eq(files.id, version.sourceFileId), eq(files.ownerId, userId), isNull(files.deletedAt))).for("update");
  if (!row || row.file.purpose !== "chart-source" || row.file.state !== "ready" || row.blob.state !== "ready" ||
    row.recipe.sourceBlobId !== row.blob.id || row.recipe.recipe !== "chart-preview-v1" || row.recipe.state !== "ready" ||
    !row.recipe.recipeBuild || row.output.state !== "ready" || row.output.mime !== CHART_PREVIEW_MIME || (await tx.select().from(blobBlocks)
      .where(inArray(blobBlocks.sha256, [row.blob.sha256, row.output.outputSha256]))).length)
    throw new StorageError(409, "CHART_FILE_NOT_READY");
  try {
    if (validateChartPreviewManifest(row.output.properties.chartPreview, row.output.size).summary.maidataMd5Base64 !== version.maidataMd5Base64)
      throw new Error("mismatched chart summary");
  } catch { throw new StorageError(409, "CHART_FILE_NOT_READY"); }
  return row;
}
export async function appendChartVersion(ctx: StorageContext, userId: string, id: string, input: { fileId: string; expectedRevision: number }): Promise<ChartDto> {
  id = id.toLowerCase();
  revision(input.expectedRevision);
  return withStorageTransaction(ctx.db, async tx => {
    await lockUploadAccounting(tx, userId);
    const chart = await ownChart(tx, userId, id, false, true);
    const previous = await assigned(tx, input.fileId);
    if (previous) {
      if (previous.chart.ownerId !== userId) throw notFound();
      if (previous.version.chartId !== id || previous.version.deletedAt) throw new StorageError(409, "CHART_FILE_ASSIGNED");
      // Lost-response replay cannot reactivate an old version after another successful change.
      return dto(tx, chart);
    }
    changed(chart, input.expectedRevision);
    const ready = await source(tx, ctx, userId, input.fileId);
    const [{ count, max }] = await tx.select({ count: sql<number>`count(*) filter (where ${chartVersions.deletedAt} is null)::integer`,
      max: sql<number>`coalesce(max(${chartVersions.ordinal}),0)::integer` }).from(chartVersions).where(eq(chartVersions.chartId, id));
    if (count >= 20 || max >= 2147483647) throw new StorageError(409, "CHART_VERSION_LIMIT");
    const now = await storageTime(tx);
    const [version] = await tx.insert(chartVersions).values({ chartId: id, ordinal: max + 1,
      sourceFileId: input.fileId, previewDerivativeId: ready.recipe.id,
      maidataMd5Base64: ready.summary.maidataMd5Base64, summary: ready.summary, createdAt: now }).returning();
    const [saved] = await tx.update(charts).set({ currentVersionId: version.id, revision: chart.revision + 1, updatedAt: now })
      .where(eq(charts.id, id)).returning();
    return dto(tx, saved);
  });
}
export async function deleteChartVersion(ctx: StorageContext, userId: string, id: string, versionId: string, expectedRevision: number) {
  id = id.toLowerCase(); versionId = versionId.toLowerCase();
  revision(expectedRevision); requireId(versionId);
  await withStorageTransaction(ctx.db, async tx => {
    await lockUploadAccounting(tx, userId);
    const chart = await ownChart(tx, userId, id, true, true);
    const [version] = await tx.select().from(chartVersions).where(and(eq(chartVersions.id, versionId), eq(chartVersions.chartId, id))).for("update");
    if (!version) throw notFound();
    if (version.deletedAt || chart.deletedAt) return;
    changed(chart, expectedRevision);
    if ((await tx.select().from(chartPublications).where(and(eq(chartPublications.chartId, id), eq(chartPublications.versionId, versionId)))).length) throw new StorageError(409, "CHART_PUBLISHED_VERSION");
    if (chart.currentVersionId === versionId) throw new StorageError(409, "CHART_CURRENT_VERSION");
    const now = await storageTime(tx);
    await tx.update(chartVersions).set({ deletedAt: now }).where(eq(chartVersions.id, versionId));
    if (!version.sourceFileId) throw new StorageError(503, "STORAGE_INCONSISTENT");
    await deleteFileInTransaction(tx, userId, version.sourceFileId);
    await tx.update(charts).set({ revision: chart.revision + 1, updatedAt: now }).where(eq(charts.id, id));
  });
}
export async function deleteChart(ctx: StorageContext, userId: string, id: string, expectedRevision: number) {
  id = id.toLowerCase();
  revision(expectedRevision);
  const sequence = await withStorageTransaction(ctx.db, async tx => {
    await lockUploadAccounting(tx, userId);
    const chart = await ownChart(tx, userId, id, true, true);
    if (chart.deletedAt) return chart.publicationSequence;
    changed(chart, expectedRevision);
    const now = await storageTime(tx);
    const [publication] = await tx.select().from(chartPublications).where(eq(chartPublications.chartId, id));
    const sequence = publication ? await recordPermission(tx, id, chart.revision + 1, null, now) : chart.publicationSequence;
    await tx.delete(chartPublications).where(eq(chartPublications.chartId, id));
    const versions = await tx.select().from(chartVersions).where(and(eq(chartVersions.chartId, id), isNull(chartVersions.deletedAt)))
      .orderBy(chartVersions.sourceFileId).for("update");
    await tx.update(charts).set({ deletedAt: now, revision: chart.revision + 1, updatedAt: now, publicationSequence: sequence }).where(eq(charts.id, id));
    await tx.update(chartVersions).set({ deletedAt: now }).where(and(eq(chartVersions.chartId, id), isNull(chartVersions.deletedAt)));
    for (const version of versions) {
      if (!version.sourceFileId) throw new StorageError(503, "STORAGE_INCONSISTENT");
      await deleteFileInTransaction(tx, userId, version.sourceFileId);
    }
    return sequence;
  });
  await awaitChartJournal(ctx, sequence);
}

export function publicationDto(p: typeof chartPublications.$inferSelect) {
  return { versionId: p.versionId, title: p.title, artist: p.artist,
    publishedAt: p.publishedAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}
