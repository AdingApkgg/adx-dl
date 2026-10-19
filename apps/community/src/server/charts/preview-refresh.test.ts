import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ingestFixture, hash } from "../../../test/storage/ingest-fixture";
import { resetTestDatabase } from "../testing/test-db";
import { testDatabaseUrl } from "../testing/services";
import { initUpload, completeUpload, getUpload } from "../storage/uploads";
import { putUploadPart } from "../storage/parts";
import { ingestUpload } from "../../media-worker/ingest";
import { handleChartImport } from "../../media-worker/chart-import";
import { finalizeUpload } from "../../media-worker/finalize";
import { createChart } from "./service";
import { planPreviewRefresh, applyPreviewRefresh } from "./preview-refresh";
import { blobDerivatives, charts, chartVersions, files, storageUsage, uploadSessions, chartPublications, storageJournalProgress, derivedObjects } from "../db/schema";
import { initializeJournal, exportJournal } from "../../../ops/backup/journal";
import { RECIPE_BUILD } from "../../media-worker/image-child";
import { requestMissingDerivedRebuild, readDerivedRebuildIntents } from "../../worker/storage-reconcile";
import { rebuildDerivedIntent } from "../storage/backup";

describe.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH && !process.env.STORAGE_TEST_MEDIA_ACCESS_KEY_ID)("source-bound preview refresh", () => {
  let f: Awaited<ReturnType<typeof ingestFixture>>, directory: string;
  const ids: string[] = [];
  beforeAll(async () => {
    await resetTestDatabase(); f = await ingestFixture(); f.mediaCtx.config.recipeBuild = RECIPE_BUILD;
    directory = await mkdtemp("/tmp/chart-refresh-journal-");
    const keyFile = join(directory, "key"); await writeFile(keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
    const config = { directory: join(directory, "log"), keyFile, databaseUrl: testDatabaseUrl() };
    await f.ctx.db.update(storageJournalProgress).set({ exportedSequence: 0, chainHash: null, exportedAt: null }).where(eq(storageJournalProgress.id, "global"));
    await initializeJournal(config); f.ctx.exportChartJournal = f.mediaCtx.exportChartJournal = async () => { await exportJournal(config); };
  }, 30000);
  afterAll(async () => {
    if (!f) return;
    if (ids.length) {
      await f.ctx.db.delete(chartPublications).where(inArray(chartPublications.chartId, ids));
      await f.ctx.db.update(charts).set({ currentVersionId: null }).where(inArray(charts.id, ids));
      await f.ctx.db.delete(chartVersions).where(inArray(chartVersions.chartId, ids));
      await f.ctx.db.delete(charts).where(inArray(charts.id, ids));
    }
    await f.cleanup(); await rm(directory, { recursive: true, force: true });
  }, 30000);
  async function historical() {
    const owner = await f.owner();
    const bytes = zipSync({ "maidata.txt": strToU8(`&title=Refresh ${crypto.randomUUID()}\n&inote_6=(120){4}1h[4:1],2,E`) }, { level: 0 });
    const dto = await initUpload(f.ctx, owner, { purpose: "chart-source", name: "old.adx", size: bytes.length, sha256: hash(bytes) }, crypto.randomUUID());
    for (let index = 0; index < dto.partCount; index++) {
      const part = bytes.subarray(index * dto.partSize, (index + 1) * dto.partSize);
      await putUploadPart(f.ctx, owner, dto.id, index, part, hash(part));
    }
    const ready = await completeUpload(f.ctx, owner, dto.id), data = { uploadId: dto.id, generation: 0 };
    await ingestUpload(f.mediaCtx, data); await handleChartImport(f.mediaCtx, data); await finalizeUpload(f.mediaCtx, data);
    const chart = await createChart(f.ctx, owner, ready.fileId!); ids.push(chart.id);
    const [version] = await f.ctx.db.select().from(chartVersions).where(eq(chartVersions.id, chart.currentVersionId));
    // A valid immutable prior build; its bytes and summary stay consistent throughout the refresh.
    await f.ctx.db.update(blobDerivatives).set({ recipeBuild: `historical-${crypto.randomUUID()}` }).where(eq(blobDerivatives.id, version.previewDerivativeId));
    return { owner, chart, version };
  }
  async function process(uploadId: string) {
    const [session] = await f.ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, uploadId));
    const data = { uploadId, generation: session.generation };
    await ingestUpload(f.mediaCtx, data); await handleChartImport(f.mediaCtx, data); await finalizeUpload(f.mediaCtx, data);
  }
  test("dry-run is read-only; apply reuses original, changes only derivative binding and returns logical quota; retries are idempotent", async () => {
    const h = await historical();
    const count = async () => (await f.ctx.db.execute(sql`select count(*)::integer as n from upload_sessions`)).rows[0].n;
    const beforeCount = await count();
    const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, h.owner));
    const plan = await planPreviewRefresh(f.mediaCtx, h.version.id);
    expect(await count()).toBe(beforeCount);
    expect(plan.artifact.manifest.summary.difficulties[0].previewSupported).toBe(true);
    const result = await applyPreviewRefresh(f.ctx, plan, { afterInit: process });
    expect(result.status).toBe("applied"); expect(result.derivativeId).not.toBe(h.version.previewDerivativeId);
    const [after] = await f.ctx.db.select().from(chartVersions).where(eq(chartVersions.id, h.version.id));
    expect(after).toMatchObject({ id: h.version.id, ordinal: h.version.ordinal, sourceFileId: h.version.sourceFileId, maidataMd5Base64: h.version.maidataMd5Base64 });
    const [original] = await f.ctx.db.select().from(files).where(eq(files.id, h.version.sourceFileId!));
    expect(original).toMatchObject({ state: "ready", deletedAt: null });
    const [afterUsage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, h.owner));
    expect(afterUsage).toMatchObject({ usedBytes: usage.usedBytes, reservedBytes: 0, activeUploads: 0 });
    expect((await f.ctx.db.select().from(files).where(and(eq(files.ownerId, h.owner), eq(files.state, "ready"))))).toHaveLength(1);
    const countApplied = await count(); expect((await applyPreviewRefresh(f.ctx, plan)).status).toBe("already-applied");
    expect(await count()).toBe(countApplied);
    expect((await f.ctx.db.select().from(blobDerivatives).where(eq(blobDerivatives.id, h.version.previewDerivativeId)))[0].recipeBuild).toStartWith("historical-");
    // Fresh derived storage must choose the executable build even when old/new recipes share bytes.
    const [recipe] = await f.ctx.db.select().from(blobDerivatives).where(eq(blobDerivatives.id, result.derivativeId));
    const [output] = await f.ctx.db.select().from(derivedObjects).where(eq(derivedObjects.id, recipe.derivedObjectId!));
    await f.cleanupDriver.delete({ bucket: "derived", key: output.key });
    expect(await requestMissingDerivedRebuild(f.mediaCtx, { id: output.id, generation: output.generation })).toBe(true);
    const intent = (await readDerivedRebuildIntents(f.mediaCtx)).find(item => item.id === output.id)!;
    expect(intent.recipeId).toBe(recipe.id);
    expect(await rebuildDerivedIntent(f.mediaCtx, intent)).toBe(true);
    expect(await f.mediaCtx.driver.head({ bucket: "derived", key: output.key })).toMatchObject({ sha256: output.outputSha256, size: output.size });
  }, 30000);
  test("a cancelled precommit attempt can retry the exact same plan without duplicating an active upload", async () => {
    const h = await historical(), plan = await planPreviewRefresh(f.mediaCtx, h.version.id);
    await expect(applyPreviewRefresh(f.ctx, plan, { afterInit: async () => { throw new Error("temporary failure"); } })).rejects.toThrow("temporary failure");
    const result = await applyPreviewRefresh(f.ctx, plan, { afterInit: process });
    expect(result.status).toBe("applied");
    const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, h.owner));
    expect(usage).toMatchObject({ reservedBytes: 0, activeUploads: 0 });
  }, 30000);
  test("a stale revision or modified plan is refused before starting any upload", async () => {
    const h = await historical(), plan = await planPreviewRefresh(f.mediaCtx, h.version.id);
    const before = await f.ctx.db.select().from(uploadSessions);
    await expect(applyPreviewRefresh(f.ctx, { ...plan, artifact: { ...plan.artifact, sha256: "0".repeat(64) } })).rejects.toThrow("PREVIEW_REFRESH_CHANGED");
    await f.ctx.db.update(charts).set({ revision: h.chart.revision + 1 }).where(eq(charts.id, h.chart.id));
    await expect(applyPreviewRefresh(f.ctx, plan)).rejects.toThrow("PREVIEW_REFRESH_CHANGED");
    expect((await f.ctx.db.select().from(uploadSessions)).length).toBe(before.length);
  }, 30000);
  test("editing during computation aborts the switch and cleans the temporary logical file", async () => {
    const h = await historical(), plan = await planPreviewRefresh(f.mediaCtx, h.version.id);
    await expect(applyPreviewRefresh(f.ctx, plan, { afterInit: async id => {
      await process(id); await f.ctx.db.update(charts).set({ revision: h.chart.revision + 1 }).where(eq(charts.id, h.chart.id));
      expect((await getUpload(f.ctx, h.owner, id)).state).toBe("ready");
    } })).rejects.toThrow("PREVIEW_REFRESH_CHANGED");
    expect((await f.ctx.db.select().from(chartVersions).where(eq(chartVersions.id, h.version.id)))[0].previewDerivativeId).toBe(h.version.previewDerivativeId);
    const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, h.owner));
    expect(usage).toMatchObject({ reservedBytes: 0, activeUploads: 0 });
    expect((await f.ctx.db.select().from(files).where(and(eq(files.ownerId, h.owner), eq(files.state, "ready"))))).toHaveLength(1);
  }, 30000);
});
