import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ChartPreviewManifest } from "@/shared/charts";
import { blobBlocks, blobDerivatives, blobs, chartModerations, chartPublications, chartVersions, charts, derivedObjects, files, uploadSessions, user } from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import type { ReferenceDb } from "../storage/references";
import { withStorageTransaction } from "../storage/transactions";
import { checkStorageDisk, lockUploadAccounting, storageTime } from "../storage/usage";
import { initUpload, getUpload, cancelUpload } from "../storage/uploads";
import { deleteFile, deleteFileInTransaction } from "../storage/files";
import { copyVerified } from "../../media-worker/avatar";
import { processChart } from "../../media-worker/chart-child";
import { validateChartPreviewManifest } from "./artifact";
import { currentChartRecipeBuild, CHART_PREVIEW_MIME } from "./recipe";
import { awaitChartJournal, recordPermission } from "./publication-journal";
import { publicationDto } from "./service";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const refreshDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function changed(): never { throw new Error("PREVIEW_REFRESH_CHANGED"); }
async function target(db: ReferenceDb, versionId: string) {
  const [row] = await db.select({ version: chartVersions, chart: charts, file: files, blob: blobs, recipe: blobDerivatives, output: derivedObjects }).from(chartVersions)
    .innerJoin(charts, eq(charts.id, chartVersions.chartId)).innerJoin(user, and(eq(user.id, charts.ownerId), eq(user.status, "active")))
    .innerJoin(files, and(eq(files.id, chartVersions.sourceFileId), eq(files.ownerId, charts.ownerId)))
    .innerJoin(blobs, eq(blobs.id, files.blobId)).innerJoin(blobDerivatives, and(eq(blobDerivatives.id, chartVersions.previewDerivativeId), eq(blobDerivatives.sourceBlobId, blobs.id)))
    .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId))
    .where(and(eq(chartVersions.id, versionId), isNull(chartVersions.deletedAt), isNull(charts.deletedAt), isNull(files.deletedAt)));
  if (!row || !row.chart.ownerId || row.file.purpose !== "chart-source" || row.file.state !== "ready" || row.blob.state !== "ready" || !row.blob.verifiedAt || row.file.size !== row.blob.size || row.recipe.recipe !== "chart-preview-v1" || row.recipe.state !== "ready" || row.output.state !== "ready" || row.output.mime !== CHART_PREVIEW_MIME) changed();
  if ((await db.select().from(chartModerations).where(eq(chartModerations.chartId, row.chart.id))).length || (await db.select().from(blobBlocks).where(inArray(blobBlocks.sha256, [row.blob.sha256, row.output.outputSha256]))).length) changed();
  const manifest = validateChartPreviewManifest(row.output.properties.chartPreview, row.output.size);
  if (refreshDigest(manifest.summary) !== refreshDigest(row.version.summary) || manifest.summary.maidataMd5Base64 !== row.version.maidataMd5Base64) changed();
  const [publication] = await db.select().from(chartPublications).where(eq(chartPublications.chartId, row.chart.id));
  return { row, publication: publication ? publicationDto(publication) : null, snapshot: {
    versionId, chartId: row.chart.id, ownerId: row.chart.ownerId!, sourceFileId: row.file.id, sourceBlobId: row.blob.id,
    sourceSha256: row.blob.sha256, sourceSize: row.blob.size, sourceName: row.file.originalName,
    previousDerivativeId: row.recipe.id, previousOutputSha256: row.output.outputSha256,
    summaryDigest: refreshDigest(row.version.summary), maidataMd5Base64: row.version.maidataMd5Base64,
    revision: row.chart.revision, publicationDigest: refreshDigest(publication ? publicationDto(publication) : null),
  } };
}
export type PreviewRefreshPlan = {
  format: 1; operationId: string; build: string; snapshot: Awaited<ReturnType<typeof target>>["snapshot"];
  artifact: { sha256: string; size: number; manifest: ChartPreviewManifest }; digest: string;
};
function planBody(plan: Omit<PreviewRefreshPlan, "digest"> | PreviewRefreshPlan) {
  return { format: plan.format, operationId: plan.operationId, build: plan.build, snapshot: plan.snapshot, artifact: plan.artifact };
}
function validatePlan(plan: PreviewRefreshPlan) {
  if (plan.format !== 1 || !/^[0-9a-f-]{36}$/.test(plan.operationId) || plan.build !== currentChartRecipeBuild() || plan.digest !== refreshDigest(planBody(plan))) changed();
  const manifest = validateChartPreviewManifest(plan.artifact.manifest, plan.artifact.size);
  if (!/^[0-9a-f]{64}$/.test(plan.artifact.sha256) || manifest.summary.maidataMd5Base64 !== plan.snapshot.maidataMd5Base64) changed();
}
/** Read-only rehearsal: verifies original bytes and computes a bounded new artifact, then removes scratch. */
export async function planPreviewRefresh(ctx: StorageContext, versionId: string): Promise<PreviewRefreshPlan> {
  if (ctx.config.role !== "media") throw new Error("PREVIEW_REFRESH_MEDIA_ROLE_REQUIRED");
  const initial = await target(ctx.db, versionId);
  await checkStorageDisk(ctx);
  const directory = await mkdtemp(join(ctx.config.tempDir, "chart-refresh-plan-"));
  try {
    const input = join(directory, "original.zip"), output = join(directory, "preview");
    const signal = AbortSignal.timeout(120000);
    await copyVerified(ctx, "original", initial.row.blob.key, input, initial.row.blob.size, initial.row.blob.sha256, signal);
    const result = await processChart(input, output, signal);
    if (result.summary.maidataMd5Base64 !== initial.snapshot.maidataMd5Base64 || refreshDigest((await target(ctx.db, versionId)).snapshot) !== refreshDigest(initial.snapshot)) changed();
    const body: Omit<PreviewRefreshPlan, "digest"> = { format: 1, operationId: crypto.randomUUID(), build: currentChartRecipeBuild(), snapshot: initial.snapshot,
      artifact: { sha256: result.artifact.sha256, size: result.artifact.size, manifest: result.manifest } };
    return { ...body, digest: refreshDigest(body) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
function attemptKey(operationId: string, attempt: number) {
  if (attempt === 0) return operationId;
  const hex = createHash("sha256").update(`${operationId}:${attempt}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
async function reusableAttempt(ctx: StorageContext, plan: PreviewRefreshPlan) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const idempotencyKey = attemptKey(plan.operationId, attempt);
    const [previous] = await ctx.db.select().from(uploadSessions).where(and(eq(uploadSessions.ownerId, plan.snapshot.ownerId), eq(uploadSessions.idempotencyKey, idempotencyKey)));
    if (!previous) return idempotencyKey;
    if (previous.state === "receiving" || previous.state === "processing") return idempotencyKey;
    if (previous.state === "ready" && previous.fileId) {
      const [file] = await ctx.db.select().from(files).where(eq(files.id, previous.fileId));
      if (file?.state === "ready" && !file.deletedAt) return idempotencyKey;
    }
  }
  throw new Error("PREVIEW_REFRESH_REPLAN_REQUIRED");
}
/** Only normal upload/recipe code reserves bytes and writes objects. No immutable output is overwritten. */
export async function applyPreviewRefresh(ctx: StorageContext, plan: PreviewRefreshPlan, options: { afterInit?: (uploadId: string) => Promise<void> } = {}) {
  if (ctx.config.role !== "web") throw new Error("PREVIEW_REFRESH_WEB_ROLE_REQUIRED");
  validatePlan(plan);
  const before = await target(ctx.db, plan.snapshot.versionId);
  const alreadyApplied = before.row.recipe.recipeBuild === plan.build && before.row.output.outputSha256 === plan.artifact.sha256 && refreshDigest(before.row.version.summary) === refreshDigest(plan.artifact.manifest.summary);
  if (alreadyApplied) { await awaitChartJournal(ctx, before.row.chart.publicationSequence); return { status: "already-applied", versionId: before.row.version.id, derivativeId: before.row.recipe.id, outputSha256: before.row.output.outputSha256 }; }
  if (refreshDigest(before.snapshot) !== refreshDigest(plan.snapshot)) changed();
  const upload = await initUpload(ctx, plan.snapshot.ownerId, { purpose: "chart-source", name: plan.snapshot.sourceName, size: plan.snapshot.sourceSize, sha256: plan.snapshot.sourceSha256 }, await reusableAttempt(ctx, plan));
  let fileId: string | undefined;
  let committed = false;
  try {
    if (upload.state === "receiving") { await cancelUpload(ctx, plan.snapshot.ownerId, upload.id); changed(); }
    await options.afterInit?.(upload.id);
    const deadline = Date.now() + 120000;
    while (true) {
      const state = await getUpload(ctx, plan.snapshot.ownerId, upload.id);
      if (state.state === "ready") { fileId = state.fileId; break; }
      if (state.state !== "processing" || Date.now() >= deadline) throw new Error("PREVIEW_REFRESH_PROCESSING_INCOMPLETE");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!fileId || fileId === plan.snapshot.sourceFileId) changed();
    const result = await withStorageTransaction(ctx.db, async tx => {
      await lockUploadAccounting(tx, plan.snapshot.ownerId);
      await tx.select().from(charts).where(eq(charts.id, plan.snapshot.chartId)).for("update");
      await tx.select().from(chartVersions).where(eq(chartVersions.id, plan.snapshot.versionId)).for("update");
      // Block concurrent hash takedown, original retirement and GC while switching the binding.
      await tx.select().from(files).where(inArray(files.id, [plan.snapshot.sourceFileId, fileId!])).orderBy(files.id).for("update");
      await tx.select().from(blobs).where(eq(blobs.id, plan.snapshot.sourceBlobId)).for("update");
      const current = await target(tx, plan.snapshot.versionId);
      if (refreshDigest(current.snapshot) !== refreshDigest(plan.snapshot) || current.row.chart.revision >= 2147483647) changed();
      const [temporary] = await tx.select().from(files).where(eq(files.id, fileId!));
      const [recipe] = await tx.select().from(blobDerivatives).where(and(eq(blobDerivatives.sourceBlobId, current.row.blob.id), eq(blobDerivatives.recipe, "chart-preview-v1"), eq(blobDerivatives.recipeBuild, plan.build))).for("update");
      if (!temporary || temporary.ownerId !== plan.snapshot.ownerId || temporary.blobId !== plan.snapshot.sourceBlobId || temporary.state !== "ready" || temporary.deletedAt || temporary.purpose !== "chart-source" || !recipe || recipe.state !== "ready" || !recipe.derivedObjectId) changed();
      const [output] = await tx.select().from(derivedObjects).where(eq(derivedObjects.id, recipe.derivedObjectId!)).for("update");
      if (!output || output.state !== "ready" || output.outputSha256 !== plan.artifact.sha256 || output.size !== plan.artifact.size || refreshDigest(output.properties.chartPreview) !== refreshDigest(plan.artifact.manifest) || (await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, output.outputSha256))).length) changed();
      const now = await storageTime(tx), revision = current.row.chart.revision + 1;
      await tx.update(chartVersions).set({ previewDerivativeId: recipe.id, summary: plan.artifact.manifest.summary }).where(eq(chartVersions.id, plan.snapshot.versionId));
      const sequence = await recordPermission(tx, current.row.chart.id, revision, current.publication, now, plan.snapshot.ownerId);
      await tx.update(charts).set({ revision, publicationSequence: sequence }).where(eq(charts.id, current.row.chart.id));
      // Return the temporary logical quota through the existing deletion/journal protocol.
      await deleteFileInTransaction(tx, plan.snapshot.ownerId, fileId!);
      return { status: "applied", versionId: current.row.version.id, derivativeId: recipe.id, outputSha256: output.outputSha256, sequence };
    });
    committed = true;
    await awaitChartJournal(ctx, result.sequence);
    return result;
  } catch (error) {
    if (!committed) {
      const state = await getUpload(ctx, plan.snapshot.ownerId, upload.id);
      if (state.state === "ready" && state.fileId && state.fileId !== plan.snapshot.sourceFileId) await deleteFile(ctx, plan.snapshot.ownerId, state.fileId);
      else if (["receiving", "processing"].includes(state.state)) await cancelUpload(ctx, plan.snapshot.ownerId, upload.id);
    }
    throw error;
  }
}
