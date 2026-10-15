import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PublicChartDto, PublicChartsPageDto } from "@/shared/charts";
import {
  blobs,
  blobBlocks,
  blobDerivatives,
  charts,
  chartVersions,
  chartPublications,
  derivedObjects,
  files,
  user,
} from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import { StorageError, StorageUnavailableError } from "../storage/errors";
import { withStorageTransaction } from "../storage/transactions";
import { lockUploadAccounting, storageTime } from "../storage/usage";
import { UUID_PATTERN } from "../uuid";
import { dto, ownChart, publicationDto, verifyHistoricalSource } from "./service";
import { validateChartPreviewManifest, chartArtifactDataStart } from "./artifact";
import { CHART_PREVIEW_MIME } from "./recipe";
import { recordPermission, awaitChartJournal } from "./publication-journal";
const missing = () => new StorageError(404, "NOT_FOUND");
const invalid = () => new HTTPException(400, { message: "Invalid chart request" });
export async function publishChart(
  ctx: StorageContext,
  userId: string,
  id: string,
  input: { expectedRevision: number; versionId: string; confirmOriginalArchive: boolean },
) {
  if (
    input.confirmOriginalArchive !== true ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  )
    throw invalid();
  if (!UUID_PATTERN.test(input.versionId)) throw missing();
  id = id.toLowerCase();
  const result = await withStorageTransaction(ctx.db, async (tx) => {
    await lockUploadAccounting(tx, userId);
    const chart = await ownChart(tx, userId, id, false, true);
    const [p] = await tx.select().from(chartPublications).where(eq(chartPublications.chartId, id));
    if (
      p?.versionId === input.versionId.toLowerCase() &&
      p.title === chart.title &&
      p.artist === chart.artist
    )
      return { chart, sequence: chart.publicationSequence };
    if (chart.revision !== input.expectedRevision || chart.revision >= 2147483647)
      throw new StorageError(409, "CHART_CHANGED");
    const [version] = await tx
      .select()
      .from(chartVersions)
      .where(
        and(
          eq(chartVersions.id, input.versionId),
          eq(chartVersions.chartId, id),
          isNull(chartVersions.deletedAt),
        ),
      )
      .for("update");
    if (!version) throw missing();
    const source = await verifyHistoricalSource(tx, userId, version);
    if (source.file.size !== source.blob.size || source.blob.detectedMime !== "application/zip")
      throw new StorageError(409, "CHART_FILE_NOT_READY");
    try {
      const signal = AbortSignal.timeout(10000);
      const [original, preview] = await Promise.all([
        ctx.driver.head({ bucket: "original", key: source.blob.key, signal }),
        ctx.driver.head({ bucket: "derived", key: source.output.key, signal }),
      ]);
      if (
        !original ||
        original.size !== source.blob.size ||
        original.sha256 !== source.blob.sha256 ||
        original.mime !== "application/zip" ||
        !preview ||
        preview.size !== source.output.size ||
        preview.sha256 !== source.output.outputSha256 ||
        preview.mime !== source.output.mime
      )
        throw new StorageUnavailableError();
    } catch {
      throw new StorageUnavailableError();
    }
    const now = await storageTime(tx);
    const value = {
      chartId: id,
      versionId: version.id,
      title: chart.title,
      artist: chart.artist,
      publishedAt: p?.publishedAt ?? now,
      updatedAt: now,
    };
    await tx
      .insert(chartPublications)
      .values(value)
      .onConflictDoUpdate({ target: chartPublications.chartId, set: value });
    const sequence = await recordPermission(tx, id, chart.revision + 1, publicationDto(value), now);
    const [saved] = await tx
      .update(charts)
      .set({ revision: chart.revision + 1, updatedAt: now, publicationSequence: sequence })
      .where(eq(charts.id, id))
      .returning();
    return { chart: saved, sequence };
  });
  await awaitChartJournal(ctx, result.sequence);
  return dto(ctx.db, result.chart);
}
export async function withdrawChart(
  ctx: StorageContext,
  userId: string,
  id: string,
  expectedRevision: number,
) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw invalid();
  id = id.toLowerCase();
  const result = await withStorageTransaction(ctx.db, async (tx) => {
    await lockUploadAccounting(tx, userId);
    const chart = await ownChart(tx, userId, id, false, true);
    const [p] = await tx.select().from(chartPublications).where(eq(chartPublications.chartId, id));
    if (!p) return { chart, sequence: chart.publicationSequence };
    if (chart.revision !== expectedRevision || chart.revision >= 2147483647)
      throw new StorageError(409, "CHART_CHANGED");
    const now = await storageTime(tx);
    await tx.delete(chartPublications).where(eq(chartPublications.chartId, id));
    const sequence = await recordPermission(tx, id, chart.revision + 1, null, now);
    const [saved] = await tx
      .update(charts)
      .set({ revision: chart.revision + 1, updatedAt: now, publicationSequence: sequence })
      .where(eq(charts.id, id))
      .returning();
    return { chart: saved, sequence };
  });
  await awaitChartJournal(ctx, result.sequence);
  return dto(ctx.db, result.chart);
}
// One authorization query for each request, including validators and HEAD. No File permission is changed.
function query(ctx: StorageContext) {
  return ctx.db
    .select({
      chart: charts,
      p: chartPublications,
      v: chartVersions,
      file: files,
      blob: blobs,
      recipe: blobDerivatives,
      output: derivedObjects,
      authorId: user.id,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(chartPublications)
    .innerJoin(charts, eq(charts.id, chartPublications.chartId))
    .leftJoin(user, eq(user.id, charts.ownerId))
    .innerJoin(
      chartVersions,
      and(eq(chartVersions.id, chartPublications.versionId), eq(chartVersions.chartId, charts.id)),
    )
    .innerJoin(files, eq(files.id, chartVersions.sourceFileId))
    .innerJoin(blobs, eq(blobs.id, files.blobId))
    .innerJoin(
      blobDerivatives,
      and(
        eq(blobDerivatives.id, chartVersions.previewDerivativeId),
        eq(blobDerivatives.sourceBlobId, blobs.id),
      ),
    )
    .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId));
}
function allowed() {
  return and(
    isNull(charts.deletedAt),
    isNull(chartVersions.deletedAt),
    isNull(files.deletedAt),
    eq(files.state, "ready"),
    eq(files.purpose, "chart-source"),
    eq(blobs.state, "ready"),
    eq(blobDerivatives.state, "ready"),
    eq(blobDerivatives.recipe, "chart-preview-v1"),
    eq(derivedObjects.state, "ready"),
    eq(derivedObjects.mime, CHART_PREVIEW_MIME),
    sql`${files.size}=${blobs.size}`,
    sql`${blobDerivatives.recipeBuild} is not null`,
    sql`${files.ownerId} is not distinct from ${charts.ownerId}`,
    or(isNull(charts.ownerId), eq(user.status, "active")),
    sql`${charts.publicationSequence}<=(select exported_sequence from storage_journal_progress where id='global')`,
    sql`not exists(select 1 from ${blobBlocks} where sha256 in (${blobs.sha256},${derivedObjects.outputSha256}))`,
  );
}
type Row = Awaited<ReturnType<typeof query>>[number];
function publicDto(r: Row): PublicChartDto {
  return {
    id: r.chart.id,
    ...publicationDto(r.p),
    ordinal: r.v.ordinal,
    summary: r.v.summary,
    sourceSize: r.file.size,
    author: r.authorId ? { id: r.authorId, name: r.authorName!, image: r.authorImage } : null,
  };
}
async function resolved(ctx: StorageContext, id: string) {
  if (!UUID_PATTERN.test(id)) throw missing();
  const [r] = await query(ctx).where(and(allowed(), eq(charts.id, id)));
  if (!r) throw missing();
  try {
    const m = validateChartPreviewManifest(r.output.properties.chartPreview, r.output.size);
    if (m.summary.maidataMd5Base64 !== r.v.maidataMd5Base64) throw missing();
    return { r, m };
  } catch {
    throw missing();
  }
}
export async function getPublicChart(ctx: StorageContext, id: string) {
  return publicDto((await resolved(ctx, id)).r);
}
export async function listPublicCharts(
  ctx: StorageContext,
  input: { limit?: number; cursor?: string } = {},
): Promise<PublicChartsPageDto> {
  const limit = input.limit ?? 24;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw invalid();
  let cursor: { at: string; id: string } | undefined;
  if (input.cursor !== undefined)
    try {
      if (input.cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw invalid();
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (
        !cursor ||
        Object.keys(cursor).sort().join() !== "at,id" ||
        !UUID_PATTERN.test(cursor.id) ||
        new Date(cursor.at).toISOString() !== cursor.at
      )
        throw invalid();
    } catch {
      throw invalid();
    }
  const rows = await query(ctx)
    .where(
      and(
        allowed(),
        cursor
          ? or(
              lt(chartPublications.updatedAt, new Date(cursor.at)),
              and(eq(chartPublications.updatedAt, new Date(cursor.at)), lt(charts.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(chartPublications.updatedAt), desc(charts.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit),
    last = page.at(-1);
  return {
    items: page.map(publicDto),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.p.updatedAt.toISOString(), id: last.chart.id }),
          ).toString("base64url")
        : null,
  };
}
export async function resolvePublicChartAsset(
  ctx: StorageContext,
  id: string,
  versionId: string,
  role: string,
) {
  const { r, m } = await resolved(ctx, id);
  if (r.v.id !== versionId.toLowerCase()) throw missing();
  const a = m.assets.find((a) => a.role === role);
  if (!a) throw missing();
  return {
    key: r.output.key,
    artifactSize: r.output.size,
    artifactSha256: r.output.outputSha256,
    artifactMime: r.output.mime,
    start: chartArtifactDataStart(m) + a.offset,
    size: a.size,
    mime: a.mime,
    sha256: a.sha256,
  };
}
export async function resolvePublicChartDownload(ctx: StorageContext, id: string) {
  const { r } = await resolved(ctx, id);
  return {
    bucket: "original" as const,
    key: r.blob.key,
    size: r.blob.size,
    mime: "application/zip",
    sha256: r.blob.sha256,
    name: `${r.p.title}-${r.chart.id}.zip`,
  };
}
