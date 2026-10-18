import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ChartImportSummary, ChartPreviewManifest } from "@/shared/charts";
import { blobBlocks, blobs, blobDerivatives, chartVersions, charts, derivedObjects, files, storageBudget, storageTombstones, storageUsage, uploadSessions, user } from "../db/schema";
import { resetTestDatabase } from "../testing/test-db";
import { prepareTestQueues } from "../testing/test-boss";
import { testDatabaseUrl } from "../testing/services";
import { readyContext, readyOwner } from "../../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { createS3Driver } from "../storage/s3";
import { sweepStorage } from "../../worker/storage-sweep";
import { deleteFile, getFile } from "../storage/files";
import { createDeletionHandlers } from "../storage/deletion";
import { hasFileReferences, hasPublicRepresentation, retainsFile } from "../storage/references";
import { purgeUser, requestDeletion } from "../services/user-deletion";
import { replayJournal } from "../../../ops/backup/restore";
import { chartManifestBytes } from "./artifact";
import { chartAssetResponse, resolveChartAsset } from "./assets";
import { recipeBuildFor, CHART_PREVIEW_MIME } from "./recipe";
import { appendChartVersion, createChart, deleteChart, deleteChartVersion, getChart, listCharts, updateChart } from "./service";

let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
beforeAll(async () => { await resetTestDatabase(); await prepareTestQueues(); fixture = await readyContext(); }, 30000);
afterAll(async () => {
  if (!fixture) return;
  // Fixture cleanup deliberately releases its own business references before its logical files.
  await fixture.ctx.db.update(charts).set({ currentVersionId: null }).where(inArray(charts.ownerId, owners));
  const ownCharts = await fixture.ctx.db.select({ id: charts.id }).from(charts).where(inArray(charts.ownerId, owners));
  if (ownCharts.length) {
    await fixture.ctx.db.delete(chartVersions).where(inArray(chartVersions.chartId, ownCharts.map(c => c.id)));
    await fixture.ctx.db.delete(charts).where(inArray(charts.id, ownCharts.map(c => c.id)));
  }
  await cleanupStorageFixture(fixture.ctx.db, owners, [fixture.policy.id],
    process.env.STORAGE_TEST_FIXTURE_PATH ? createS3Driver(await storageFixtureConfig("control")) : undefined, true);
}, 30000);
async function owner() { const id = await readyOwner(fixture.ctx); owners.push(id); return id; }
async function chartFile(ownerId: string, input: { title?: string; build?: string; state?: "ready" | "processing"; purpose?: "avatar" | "chart-source" } = {}) {
  const { ctx, policy } = fixture;
  const original = Buffer.from(crypto.randomUUID());
  const sourceSha = createHash("sha256").update(original).digest("hex");
  const maidata = Buffer.from(`&title=${input.title ?? ""}\n&inote_4=(120){4}1,2,E\n${crypto.randomUUID()}`);
  const summary: ChartImportSummary = { title: input.title ?? "", artist: "", maidataMd5Base64: createHash("md5").update(maidata).digest("base64"),
    difficulties: [{ difficulty: 4, level: null, noteCount: 2, durationMs: 1000, previewSupported: true }], warnings: [], audio: null, hasCover: false };
  const manifest: ChartPreviewManifest = { format: 1, assets: [{ role: "maidata", path: "maidata.txt", mime: "text/plain; charset=utf-8",
    size: maidata.length, sha256: createHash("sha256").update(maidata).digest("hex"), offset: 0 }], summary };
  const meta = chartManifestBytes(manifest), header = Buffer.alloc(12); header.write("ADXCPV1\0", "ascii"); header.writeUInt32LE(meta.length, 8);
  const artifact = Buffer.concat([header, meta, maidata]), outputSha = createHash("sha256").update(artifact).digest("hex");
  const [blob] = await ctx.db.insert(blobs).values({ policyId: policy.id, sha256: sourceSha, key: `sha256/${sourceSha}`, size: original.length,
    state: "ready", detectedMime: "application/zip", verifiedAt: new Date() }).returning();
  const [output] = await ctx.db.insert(derivedObjects).values({ policyId: policy.id, outputSha256: outputSha, key: `sha256/${outputSha}`,
    size: artifact.length, mime: CHART_PREVIEW_MIME, state: "ready", properties: { chartPreview: manifest } }).returning();
  const [recipe] = await ctx.db.insert(blobDerivatives).values({ sourceBlobId: blob.id, recipe: "chart-preview-v1",
    recipeBuild: input.build ?? recipeBuildFor(ctx, "chart-source"), derivedObjectId: output.id, state: "ready" }).returning();
  const state = input.state ?? "ready";
  const [file] = await ctx.db.insert(files).values({ ownerId, blobId: blob.id, originalName: "filename fallback.zip", purpose: input.purpose ?? "chart-source",
    size: original.length, state, retainedUntil: new Date(Date.now() + 86400000) }).returning();
  await ctx.db.insert(storageUsage).values({ userId: ownerId, usedBytes: state === "ready" ? file.size : 0 }).onConflictDoUpdate({ target: storageUsage.userId,
    set: { usedBytes: sql`${storageUsage.usedBytes}+${state === "ready" ? file.size : 0}` } });
  await ctx.db.update(storageBudget).set({ originalWritten: sql`${storageBudget.originalWritten}+${file.size}`,
    derivedWritten: sql`${storageBudget.derivedWritten}+${output.size}` }).where(eq(storageBudget.id, "global"));
  return { file, blob, output, recipe, summary, artifact, original };
}
test("private save owns the ready recipe, references it, and retries one logical File without another draft", async () => {
  const { ctx } = fixture, id = await owner(), other = await owner();
  const source = await chartFile(id);
  const chart = await createChart(ctx, id, source.file.id);
  expect(chart.title).toBe("filename fallback");
  expect(chart.versions[0].summary.title).toBe("");
  expect(await createChart(ctx, id, source.file.id)).toEqual(chart);
  const page = await listCharts(ctx, id);
  expect(page.items).toHaveLength(1);
  expect(page.usage).toEqual({ usedBytes: source.file.size, reservedBytes: 0, quotaBytes: 268435456 });
  await ctx.db.insert(uploadSessions).values({ ownerId: other, purpose: "chart-source", originalName: "capacity.zip",
    expectedSha256: "2".repeat(64), expectedSize: 17, partSize: 4194304, partCount: 1,
    expiresAt: new Date(Date.now() + 86400000), reservedBytes: 17, idempotencyKey: crypto.randomUUID(), requestDigest: "3".repeat(64) });
  await ctx.db.insert(storageUsage).values({ userId: other, reservedBytes: 17, activeUploads: 1 })
    .onConflictDoUpdate({ target: storageUsage.userId, set: { reservedBytes: 17, activeUploads: 1 } });
  expect((await listCharts(ctx, other)).usage).toEqual({ usedBytes: 0, reservedBytes: 17, quotaBytes: 268435456 });
  expect((await listCharts(ctx, id)).usage.reservedBytes).toBe(0);
  expect(await getFile(ctx, id, source.file.id)).toMatchObject({ chart: source.summary });
  expect(await hasFileReferences(ctx.db, source.file.id)).toBe(true);
  expect(await retainsFile(ctx.db, source.file.id)).toBe(true);
  expect(await hasPublicRepresentation(ctx.db, source.output.outputSha256)).toBe(false);
  await expect(createChart(ctx, other, source.file.id)).rejects.toMatchObject({ status: 404 });
  await expect(getChart(ctx, other, chart.id)).rejects.toMatchObject({ status: 404 });
  await expect(resolveChartAsset(ctx, other, chart.id, chart.currentVersionId, "maidata")).rejects.toMatchObject({ status: 404 });
  await expect(deleteFile(ctx, id, source.file.id)).rejects.toMatchObject({ code: "FILE_IN_USE" });
  const pending = await chartFile(id, { state: "processing" });
  await expect(createChart(ctx, id, pending.file.id)).rejects.toMatchObject({ code: "CHART_FILE_NOT_READY" });
  const oldBuild = await chartFile(id, { build: "unavailable-old-import-build" });
  await expect(createChart(ctx, id, oldBuild.file.id)).rejects.toMatchObject({ code: "CHART_FILE_NOT_READY" });
  // A live version cannot lose its source even if a caller bypasses the normal reference guard.
  await expect(ctx.db.delete(files).where(eq(files.id, source.file.id)).execute()).rejects.toThrow();
  await ctx.db.insert(blobBlocks).values({ sha256: source.blob.sha256, reasonCode: "TEST_BLOCK" });
  await expect(resolveChartAsset(ctx, id, chart.id, chart.currentVersionId, "maidata")).rejects.toMatchObject({ status: 404 });
  await ctx.db.delete(blobBlocks).where(eq(blobBlocks.sha256, source.blob.sha256));
  await ctx.db.update(derivedObjects).set({ properties: { chartPreview: { broken: true } } }).where(eq(derivedObjects.id, source.output.id));
  await expect(resolveChartAsset(ctx, id, chart.id, chart.currentVersionId, "maidata")).rejects.toMatchObject({ status: 404 });
});
test("append/switch use revisions, historical recorded builds remain readable, and a replay cannot reactivate old history", async () => {
  const { ctx } = fixture, id = await owner(), a = await chartFile(id, { title: "A" }), b = await chartFile(id, { title: "B" });
  let chart = await createChart(ctx, id, a.file.id), first = chart.currentVersionId;
  await expect(appendChartVersion(ctx, id, chart.id, { fileId: b.file.id, expectedRevision: 9 })).rejects.toMatchObject({ code: "CHART_CHANGED" });
  expect((await getChart(ctx, id, chart.id)).currentVersionId).toBe(first);
  chart = await appendChartVersion(ctx, id, chart.id, { fileId: b.file.id, expectedRevision: chart.revision });
  expect(chart.versions.map(v => v.ordinal)).toEqual([2, 1]);
  chart = await updateChart(ctx, id, chart.id, { currentVersionId: first, expectedRevision: chart.revision });
  expect((await appendChartVersion(ctx, id, chart.id, { fileId: b.file.id, expectedRevision: 1 })).currentVersionId).toBe(first);
  expect((await appendChartVersion(ctx, id, chart.id.toUpperCase(), { fileId: b.file.id.toUpperCase(), expectedRevision: 1 })).currentVersionId).toBe(first);
  await ctx.db.update(blobDerivatives).set({ recipeBuild: "recorded-historical-build" }).where(eq(blobDerivatives.id, a.recipe.id));
  expect((await resolveChartAsset(ctx, id, chart.id, first, "maidata")).artifactSha256).toBe(a.output.outputSha256);
  const another = await createChart(ctx, id, (await chartFile(id)).file.id);
  await expect(ctx.db.update(charts).set({ currentVersionId: another.currentVersionId }).where(eq(charts.id, chart.id)).execute()).rejects.toThrow();
});
test("version deletion rolls back the domain row on failed refund, then refunds and tombstones once", async () => {
  const { ctx } = fixture, id = await owner(), a = await chartFile(id), b = await chartFile(id);
  let chart = await createChart(ctx, id, a.file.id);
  const first = chart.currentVersionId;
  chart = await appendChartVersion(ctx, id, chart.id, { fileId: b.file.id, expectedRevision: chart.revision });
  await expect(deleteChartVersion(ctx, id, chart.id, chart.currentVersionId, chart.revision)).rejects.toMatchObject({ code: "CHART_CURRENT_VERSION" });
  await expect(deleteChartVersion(ctx, id, chart.id.toUpperCase(), chart.currentVersionId.toUpperCase(), chart.revision)).rejects.toMatchObject({ code: "CHART_CURRENT_VERSION" });
  await ctx.db.update(storageUsage).set({ usedBytes: 0 }).where(eq(storageUsage.userId, id));
  await expect(deleteChartVersion(ctx, id, chart.id, first, chart.revision)).rejects.toMatchObject({ code: "STORAGE_INCONSISTENT" });
  expect((await ctx.db.select().from(chartVersions).where(eq(chartVersions.id, first)))[0].deletedAt).toBeNull();
  expect((await ctx.db.select().from(files).where(eq(files.id, a.file.id)))[0].state).toBe("ready");
  await ctx.db.update(storageUsage).set({ usedBytes: a.file.size + b.file.size }).where(eq(storageUsage.userId, id));
  await deleteChartVersion(ctx, id, chart.id, first, chart.revision);
  await deleteChartVersion(ctx, id, chart.id, first, chart.revision);
  expect((await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0].usedBytes).toBe(b.file.size);
  expect(await ctx.db.select().from(storageTombstones).where(and(eq(storageTombstones.kind, "file_deleted"), eq(storageTombstones.fileId, a.file.id)))).toHaveLength(1);
  // Exercise the real soft-reference candidate filter and File sweep, with actual owned S3 roles.
  const controlConfig = await storageFixtureConfig("control"), controlDriver = createS3Driver(controlConfig);
  const mediaDriver = createS3Driver(await storageFixtureConfig("media"));
  const body = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  for (const source of [a, b]) {
    await mediaDriver.put({ bucket: "original", key: source.blob.key, body: body(source.original),
      size: source.original.length, mime: "application/zip", sha256: source.blob.sha256 });
    await mediaDriver.put({ bucket: "derived", key: source.output.key, body: body(source.artifact),
      size: source.artifact.length, mime: CHART_PREVIEW_MIME, sha256: source.output.outputSha256 });
  }
  const expired = new Date(Date.now() - 31 * 86400000);
  await ctx.db.update(files).set({ deletedAt: expired, retainedUntil: expired }).where(eq(files.id, a.file.id));
  const swept = await sweepStorage({ ...ctx, config: controlConfig, driver: controlDriver }, undefined, 5000);
  expect(swept.filesDeleted).toBeGreaterThanOrEqual(1);
  expect(await ctx.db.select().from(files).where(eq(files.id, a.file.id))).toHaveLength(0);
  expect((await ctx.db.select().from(chartVersions).where(eq(chartVersions.id, first)))[0]).toMatchObject({ sourceFileId: null, ordinal: 1 });
  expect((await ctx.db.select().from(files).where(eq(files.id, b.file.id)))[0].state).toBe("ready");
  const remainingAsset = await resolveChartAsset(ctx, id, chart.id, chart.currentVersionId, "maidata");
  const readable = await chartAssetResponse(ctx, remainingAsset,
    new Request("https://community.example.test/private-asset"));
  expect(readable.status).toBe(200);
  expect(new Uint8Array(await readable.arrayBuffer()).byteLength).toBe(remainingAsset.size);
  chart = await getChart(ctx, id, chart.id);
  await deleteChart(ctx, id, chart.id, chart.revision);
  await deleteChart(ctx, id, chart.id, chart.revision);
  expect((await listCharts(ctx, id)).items).toHaveLength(0);
  expect((await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0].usedBytes).toBe(0);
  await expect(getChart(ctx, id, chart.id)).rejects.toMatchObject({ status: 404 });
});
test("private drafts cool off and purge even when deleteContent is false", async () => {
  const { ctx } = fixture, id = await owner(), source = await chartFile(id);
  const chart = await createChart(ctx, id, source.file.id), handlers = createDeletionHandlers(ctx);
  const result = await requestDeletion({ db: ctx.db, boss: ctx.boss, handlers }, id, { deleteContent: false });
  expect(result.status).toBe("requested");
  expect(await retainsFile(ctx.db, source.file.id)).toBe(true);
  await expect(getChart(ctx, id, chart.id)).rejects.toMatchObject({ status: 404 });
  await ctx.db.update(user).set({ deletionPurgeAt: new Date(Date.now() - 1000) }).where(eq(user.id, id));
  expect(await purgeUser({ db: ctx.db, handlers }, id)).toBe("purged");
  expect((await ctx.db.select().from(files).where(eq(files.id, source.file.id)))[0]).toMatchObject({ ownerId: null, state: "deleted" });
  expect(await ctx.db.select().from(charts).where(eq(charts.id, chart.id))).toHaveLength(0);
});
test("deleting one private logical source leaves another owner's shared physical chart readable and charged", async () => {
  const { ctx } = fixture, one = await owner(), two = await owner(), shared = await chartFile(one);
  const [otherFile] = await ctx.db.insert(files).values({ ownerId: two, blobId: shared.blob.id,
    originalName: "same physical chart.zip", purpose: "chart-source", size: shared.file.size, state: "ready",
    retainedUntil: new Date(Date.now() + 86400000) }).returning();
  await ctx.db.insert(storageUsage).values({ userId: two, usedBytes: otherFile.size });
  const first = await createChart(ctx, one, shared.file.id), second = await createChart(ctx, two, otherFile.id);
  await deleteChart(ctx, one, first.id, first.revision);
  expect((await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, one)))[0].usedBytes).toBe(0);
  expect((await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, two)))[0].usedBytes).toBe(otherFile.size);
  expect(await hasFileReferences(ctx.db, otherFile.id)).toBe(true);
  expect((await resolveChartAsset(ctx, two, second.id, second.currentVersionId, "maidata")).artifactSha256).toBe(shared.output.outputSha256);
  expect((await ctx.db.select().from(files).where(eq(files.id, otherFile.id)))[0].state).toBe("ready");
});
test("offline file tombstones hide an exclusive version, choose surviving history, and never resurrect a deleted chart", async () => {
  const { ctx } = fixture, id = await owner(), a = await chartFile(id), b = await chartFile(id);
  let chart = await createChart(ctx, id, a.file.id), first = chart.currentVersionId;
  chart = await appendChartVersion(ctx, id, chart.id, { fileId: b.file.id, expectedRevision: chart.revision });
  const connection = new Client({ connectionString: testDatabaseUrl() }); await connection.connect();
  const now = new Date().toISOString();
  const records = [b.file.id, a.file.id].map((fileId, i) => ({ sequence: 9000 + i, kind: "file_deleted" as const,
    userId: null, fileId, sha256: null, generation: null, createdAt: now }));
  try {
    await replayJournal(connection, records.slice(0, 1), { sequence: 9000, hash: "0".repeat(64), capturedAt: now });
    expect((await getChart(ctx, id, chart.id)).currentVersionId).toBe(first);
    await replayJournal(connection, records, { sequence: 9001, hash: "1".repeat(64), capturedAt: now });
    await expect(getChart(ctx, id, chart.id)).rejects.toMatchObject({ status: 404 });
    expect((await listCharts(ctx, id)).items).toHaveLength(0);
  } finally { await connection.end(); }
});
test("draft/active-version caps reject before binding another File; cursor pages do not repeat and ordinals never recycle", async () => {
  const { ctx } = fixture, id = await owner();
  const a = await chartFile(id), b = await chartFile(id), c = await chartFile(id);
  let chart = await createChart(ctx, id, a.file.id);
  await createChart(ctx, id, b.file.id); await createChart(ctx, id, c.file.id);
  const first = await listCharts(ctx, id, { limit: 2 });
  expect(first.items).toHaveLength(2); expect(first.nextCursor).not.toBeNull();
  const second = await listCharts(ctx, id, { limit: 2, cursor: first.nextCursor! });
  expect(second.items).toHaveLength(1);
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(3);
  await expect(listCharts(ctx, id, { cursor: "invalid", limit: 2 })).rejects.toMatchObject({ status: 400 });
  const candidate = await chartFile(id);
  // Small metadata-only fixtures exercise the transaction cap without uploading 50 actual packages.
  await ctx.db.insert(charts).values(Array.from({ length: 47 }, () => ({ ownerId: id, title: "cap fixture" })));
  await expect(createChart(ctx, id, candidate.file.id)).rejects.toMatchObject({ code: "CHART_DRAFT_LIMIT" });
  expect(await ctx.db.select().from(chartVersions).where(eq(chartVersions.sourceFileId, candidate.file.id))).toHaveLength(0);
  // One real ready logical File per synthetic history still preserves the exclusive File invariant.
  for (let ordinal = 2; ordinal <= 20; ordinal++) {
    const source = await chartFile(id);
    await ctx.db.insert(chartVersions).values({ chartId: chart.id, ordinal, sourceFileId: source.file.id,
      previewDerivativeId: source.recipe.id, maidataMd5Base64: source.summary.maidataMd5Base64, summary: source.summary });
  }
  await expect(appendChartVersion(ctx, id, chart.id, { fileId: candidate.file.id, expectedRevision: chart.revision })).rejects.toMatchObject({ code: "CHART_VERSION_LIMIT" });
  const [last] = await ctx.db.select().from(chartVersions).where(and(eq(chartVersions.chartId, chart.id), eq(chartVersions.ordinal, 20)));
  await deleteChartVersion(ctx, id, chart.id, last.id, chart.revision);
  chart = await getChart(ctx, id, chart.id);
  chart = await appendChartVersion(ctx, id, chart.id, { fileId: candidate.file.id, expectedRevision: chart.revision });
  expect(chart.versions[0].ordinal).toBe(21);
});

test("private metadata and version notes obey Unicode limits, ownership and optimistic revision", async () => {
  const ctx = fixture.ctx, ownerId = await owner(), otherId = await owner();
  let chart = await createChart(ctx, ownerId, (await chartFile(ownerId, { title: "Private work" })).file.id);
  const other = await createChart(ctx, otherId, (await chartFile(otherId)).file.id);
  chart = await updateChart(ctx, ownerId, chart.id, { expectedRevision: chart.revision,
    description: "😀".repeat(2000), credits: "Credit\nSource", tags: [" ＡＢＣ ", "abc"], releaseNote: { versionId: chart.currentVersionId, text: "First note" } });
  expect(chart.description).toBe("😀".repeat(2000)); expect(chart.tags).toEqual([{ key: "abc", label: "ＡＢＣ" }]);
  expect(chart.versions[0]?.releaseNote).toBe("First note"); expect(chart.publication).toBeNull();
  await expect(updateChart(ctx, ownerId, chart.id, { expectedRevision: chart.revision - 1, description: "Stale tab" })).rejects.toMatchObject({ code: "CHART_CHANGED" });
  await expect(updateChart(ctx, ownerId, chart.id, { expectedRevision: chart.revision, releaseNote: { versionId: other.currentVersionId, text: "Wrong chart" } })).rejects.toMatchObject({ status: 404 });
  await expect(updateChart(ctx, ownerId, chart.id, { expectedRevision: chart.revision, description: "😀".repeat(2001) })).rejects.toMatchObject({ status: 400 });
  await expect(updateChart(ctx, ownerId, chart.id, { expectedRevision: chart.revision, releaseNote: { versionId: chart.currentVersionId, text: "x".repeat(1001) } })).rejects.toMatchObject({ status: 400 });
  expect((await getChart(ctx, ownerId, chart.id)).revision).toBe(chart.revision);
});
test("private list cursor binds owner and filters and cannot be reused for another scope", async () => {
  const ctx = fixture.ctx, ownerId = await owner(), otherId = await owner();
  await createChart(ctx, ownerId, (await chartFile(ownerId, { title: "Search first" })).file.id);
  await createChart(ctx, ownerId, (await chartFile(ownerId, { title: "Search second" })).file.id);
  const first = await listCharts(ctx, ownerId, { q: "Search", status: "draft", limit: 1 });
  expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
  const second = await listCharts(ctx, ownerId, { q: "Search", status: "draft", limit: 1, cursor: first.nextCursor! });
  expect(second.items).toHaveLength(1); expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  for (const change of [{ q: "Other", status: "draft" }, { q: "Search", status: "published" }])
    await expect(listCharts(ctx, ownerId, { ...change, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400 });
  await expect(listCharts(ctx, otherId, { q: "Search", status: "draft", cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400 });
  await expect(listCharts(ctx, ownerId, { limit: 21 })).rejects.toMatchObject({ status: 400 });
});
