import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { readOriginalManifest } from "../../ops/backup/export";
import { testDatabaseUrl } from "../server/testing/services";
import { ingestFixture, hash } from "../../test/storage/ingest-fixture";
import { blobDerivatives, blobs, charts, chartSourceEntries, derivedObjects, files, storageBudget, storageUsage, uploadSessions } from "../server/db/schema";
import { initUpload, completeUpload, getUpload, cancelUpload } from "../server/storage/uploads";
import { putUploadPart } from "../server/storage/parts";
import { getFile } from "../server/storage/files";
import { ingestUpload } from "./ingest";
import { handleChartImport } from "./chart-import";
import { finalizeUpload } from "./finalize";
import { RECIPE_BUILD } from "./image-child";
import { requestMissingDerivedRebuild, readDerivedRebuildIntents } from "../worker/storage-reconcile";
import { rebuildDerivedIntent } from "../server/storage/backup";
import { resetTestDatabase } from "../server/testing/test-db";
import { chartBackfillRemaining } from "../server/charts/source-backfill";
import { createChart } from "../server/charts/service";
import { MEDIA_CHART_CAS_QUEUE } from "../server/jobs/queues";
import { createBoss } from "../server/jobs/boss";
import { registerMediaWorkers } from "./main";
import { watchProcessingUpload } from "./upload-cancellation";
import { processChart } from "./chart-child";
import { originalHasDependencies } from "../worker/storage-delete";
import { recordStorageDead } from "../worker/storage-sweep";
import { claimRecipe, claimRecipeOutput, releaseRecipeComputation } from "../server/storage/objects";
import { CHART_PREVIEW_MIME } from "../server/charts/recipe";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
describe.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH && !process.env.STORAGE_TEST_MEDIA_ACCESS_KEY_ID)("private chart import on isolated PG and authenticated S3",()=>{
  let f: Awaited<ReturnType<typeof ingestFixture>>;
  beforeAll(async()=>{await resetTestDatabase();f=await ingestFixture();f.mediaCtx.config.recipeBuild=RECIPE_BUILD;},30_000);
  let legacyChartId: string | undefined;
  afterAll(async () => {
    if (legacyChartId) await f.ctx.db.delete(charts).where(eq(charts.id, legacyChartId));
    await f?.cleanup();
  }, 30_000);
  async function upload(bytes: Uint8Array, name = "fixture.zip") {
    const userId = await f.owner();
    const dto = await initUpload(f.ctx,userId,{purpose:"chart-source",name,size:bytes.length,sha256:hash(bytes)},crypto.randomUUID());
    for(let index=0;index<dto.partCount;index++) {
      const part = bytes.subarray(index*dto.partSize,(index+1)*dto.partSize);
      await putUploadPart(f.ctx,userId,dto.id,index,part,hash(part));
    }
    const completed = await completeUpload(f.ctx,userId,dto.id);
    return {userId,dto:completed,data:{uploadId:dto.id,generation:0}};
  }
  test("ready chart requires its own recipe; duplicate delivery charges once and exact-build private artifact rebuilds",async()=>{
    const bytes = zipSync({"maidata.txt":strToU8(`&title=Private ${crypto.randomUUID()}\n&inote_4=(120){4}1,2,E\n`)},{level:0});
    const u = await upload(bytes);
    const jobs = await f.ctx.db.execute(sql`select name from pgboss.job where data->>'uploadId'=${u.dto.id} order by name`);
    expect(jobs.rows.map(r=>r.name)).toEqual(["media.chart-import","storage.finalize","storage.ingest"]);
    await ingestUpload(f.mediaCtx,u.data);
    await expect(finalizeUpload(f.mediaCtx,u.data)).rejects.toMatchObject({code:"STORAGE_BUSY"});
    await handleChartImport(f.mediaCtx,u.data);
    await finalizeUpload(f.mediaCtx,u.data);
    const [before] = await f.ctx.db.select().from(storageBudget);
    await handleChartImport(f.mediaCtx,u.data); await finalizeUpload(f.mediaCtx,u.data); await ingestUpload(f.mediaCtx,u.data);
    const dto = await getFile(f.ctx,u.userId,u.dto.fileId!);
    expect(dto).toMatchObject({purpose:"chart-source",state:"ready",chart:{audio:null,hasCover:false}});
    expect(dto.previewUrl).toBeUndefined();
    const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,u.userId));
    expect(usage).toMatchObject({usedBytes:bytes.length,reservedBytes:0,activeUploads:0});
    const [after] = await f.ctx.db.select().from(storageBudget);
    expect(after).toEqual(before);
    const [file] = await f.ctx.db.select().from(files).where(eq(files.id,dto.id));
    const [recipe] = await f.ctx.db.select().from(blobDerivatives).where(eq(blobDerivatives.sourceBlobId,file.blobId));
    expect(recipe.recipe).toBe("chart-preview-v1");
    const [output] = await f.ctx.db.select().from(derivedObjects).where(eq(derivedObjects.id,recipe.derivedObjectId!));
    await f.cleanupDriver.delete({bucket:"derived",key:output.key});
    expect(await requestMissingDerivedRebuild(f.mediaCtx,{id:output.id,generation:output.generation})).toBe(true);
    const intent = (await readDerivedRebuildIntents(f.mediaCtx)).find(i=>i.id===output.id)!;
    expect(await rebuildDerivedIntent(f.mediaCtx,intent)).toBe(true);
    expect(await f.mediaCtx.driver.head({bucket:"derived",key:output.key})).toMatchObject({size:output.size,sha256:output.outputSha256,mime:output.mime});
  },30_000);
  test("ADX filename with ZIP bytes passes the real ingest/import/finalize chain unchanged", async () => {
    const bytes = zipSync({ "maidata.txt": strToU8("&title=ADX import\n&inote_4=(120){4}1,2,E\n") }, { level: 0 });
    const u = await upload(bytes, "single-chart.adx");
    await ingestUpload(f.mediaCtx, u.data);
    await handleChartImport(f.mediaCtx, u.data);
    await finalizeUpload(f.mediaCtx, u.data);
    expect(await getFile(f.ctx, u.userId, u.dto.fileId!)).toMatchObject({
      name: "single-chart.adx", purpose: "chart-source", size: bytes.length,
      state: "ready", chart: { title: "ADX import" },
    });
  }, 30_000);
  test("format rejection and cancellation terminalize without a ready File or double quota release",async()=>{
    const malformed = await upload(zipSync({"readme.bin":strToU8("no maidata")},{level:0}));
    await ingestUpload(f.mediaCtx,malformed.data); await handleChartImport(f.mediaCtx,malformed.data);
    expect(await getUpload(f.ctx,malformed.userId,malformed.dto.id)).toMatchObject({state:"rejected",errorCode:"CHART_MAIDATA_MISSING"});
    await handleChartImport(f.mediaCtx,malformed.data); await finalizeUpload(f.mediaCtx,malformed.data);
    const canceled = await upload(zipSync({"maidata.txt":strToU8("&inote_4=(120)1,E")},{level:0}));
    await cancelUpload(f.ctx,canceled.userId,canceled.dto.id);
    await ingestUpload(f.mediaCtx,canceled.data); await handleChartImport(f.mediaCtx,canceled.data); await finalizeUpload(f.mediaCtx,canceled.data);
    const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,canceled.userId));
    expect(usage).toMatchObject({usedBytes:0,reservedBytes:0,activeUploads:0});
    const [session] = await f.ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id,canceled.dto.id));
    expect(session.state).toBe("cancelled");
    expect((await f.ctx.db.select().from(files).where(eq(files.id,canceled.dto.fileId!)))[0].state).not.toBe("ready");
  },30_000);
  test("real Navigator advances chart ingest, import and finalize", async()=>{
    const worker = createBoss(process.env.TEST_DATABASE_URL!, "worker");
    await worker.start();
    try {
      await registerMediaWorkers({...f.mediaCtx,boss:async()=>worker});
      const bytes = zipSync({"maidata.txt":strToU8(`&title=Navigator ${crypto.randomUUID()}\n&inote_4=(120){4}1,2,E`)},{level:0});
      const u = await upload(bytes);
      const deadline = Date.now()+20_000;
      let result: Awaited<ReturnType<typeof getUpload>> | undefined;
      do {
        result = await getUpload(f.ctx,u.userId,u.dto.id);
        if(result.state === "ready" || result.state === "rejected") break;
        await Bun.sleep(100);
      } while(Date.now()<deadline);
      if (result?.state !== "ready") {
        const jobs = await f.ctx.db.execute(sql`select name, state, retry_count from pgboss.job where data->>'uploadId'=${u.dto.id} order by name`);
        throw new Error(`Navigator stalled in ${result?.state}: ${JSON.stringify(jobs.rows)}`);
      }
      expect(await getFile(f.ctx,u.userId,u.dto.fileId!)).toMatchObject({purpose:"chart-source",state:"ready"});
      const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,u.userId));
      expect(usage).toMatchObject({usedBytes:bytes.length,reservedBytes:0,activeUploads:0});
    } finally { await worker.stop({graceful:true,timeout:5_000}); }
  },30_000);
  test("the media worker backfills a legacy chart and keeps its original archive", async () => {
    const maidata = strToU8(`&title=Legacy ${crypto.randomUUID()}\n&inote_4=(120){4}1,2,E\n`);
    const bytes = zipSync({ "maidata.txt": maidata, "empty.txt": new Uint8Array() });
    const u = await upload(bytes);
    await ingestUpload(f.mediaCtx, u.data);
    await handleChartImport(f.mediaCtx, u.data);
    await finalizeUpload(f.mediaCtx, u.data);
    legacyChartId = (await createChart(f.ctx, u.userId, u.dto.fileId!)).id;
    const [file] = await f.ctx.db.select().from(files).where(eq(files.id, u.dto.fileId!));
    const [source] = await f.ctx.db.select().from(blobs).where(eq(blobs.id, file.blobId));
    const manifest = await f.ctx.db.delete(chartSourceEntries)
      .where(eq(chartSourceEntries.sourceBlobId, source.id)).returning();
    expect(manifest).toHaveLength(2);
    const [budgetBefore] = await f.ctx.db.select().from(storageBudget);
    expect(await chartBackfillRemaining(f.ctx, 5)).toContainEqual({ id: source.id, size: bytes.length });

    const worker = createBoss(process.env.TEST_DATABASE_URL!, "worker");
    await worker.start();
    try {
      await registerMediaWorkers({ ...f.mediaCtx, boss: async () => worker });
      for (const expected of ["migrated", "skipped"]) {
        const jobId = await worker.send(MEDIA_CHART_CAS_QUEUE, { sourceId: source.id }, { singletonKey: source.id });
        expect(jobId).toBeTruthy();
        const deadline = Date.now() + 12_000;
        let receipt: string | undefined;
        do {
          const result = await f.ctx.db.execute<{ state: string; status: string }>(sql`
            select state, output->>'status' as status from pgboss.job
            where name = ${MEDIA_CHART_CAS_QUEUE} and id = ${jobId}
          `);
          if (result.rows[0]?.state === "completed") {
            receipt = result.rows[0].status;
            break;
          }
          expect(result.rows[0]?.state).not.toBe("failed");
          await Bun.sleep(100);
        } while (Date.now() < deadline);
        expect(receipt).toBe(expected);
      }
    } finally {
      await worker.stop({ graceful: true, timeout: 5_000 });
    }
    expect(await chartBackfillRemaining(f.ctx, 5)).toEqual([]);
    const entries = await f.ctx.db.select().from(chartSourceEntries)
      .where(eq(chartSourceEntries.sourceBlobId, source.id));
    expect(entries.map(row => [row.path, row.contentBlobId]).sort())
      .toEqual(manifest.map(row => [row.path, row.contentBlobId]).sort());
    expect(await f.mediaCtx.driver.head({ bucket: "original", key: source.key }))
      .toMatchObject({ size: bytes.length, sha256: hash(bytes) });
    const [budgetAfter] = await f.ctx.db.select().from(storageBudget);
    expect(budgetAfter.originalWritten).toBe(budgetBefore.originalWritten);
  }, 35_000);
  test("different uploads share identical loose file bytes in original CAS", async () => {
    const attachment = strToU8(`shared ${crypto.randomUUID()}`);
    const sourceIds: string[] = [];
    for (const title of ["First CAS chart", "Second CAS chart"]) {
      const bytes = zipSync({
        "song/maidata.txt": strToU8(`&title=${title}\n&inote_4=(120){4}1,2,E\n`),
        "song/credits.md": attachment, "song/empty.txt": new Uint8Array(),
      });
      const u = await upload(bytes);
      await ingestUpload(f.mediaCtx, u.data);
      await handleChartImport(f.mediaCtx, u.data);
      await finalizeUpload(f.mediaCtx, u.data);
      const [file] = await f.ctx.db.select().from(files).where(eq(files.id, u.dto.fileId!));
      sourceIds.push(file!.blobId);
    }
    expect(new Set(sourceIds).size).toBe(2);
    const refs = await f.ctx.db.select().from(chartSourceEntries).where(eq(chartSourceEntries.sha256, hash(attachment)));
    expect(refs.map(ref => ref.sourceBlobId).sort()).toEqual(sourceIds.sort());
    expect(new Set(refs.map(ref => ref.contentBlobId)).size).toBe(1);
    const [object] = await f.ctx.db.select().from(blobs).where(eq(blobs.sha256, hash(attachment)));
    expect(object).toMatchObject({ id: refs[0]!.contentBlobId, state: "ready", size: attachment.length });
    expect(await f.mediaCtx.driver.head({ bucket: "original", key: object!.key })).toMatchObject({
      size: attachment.length, sha256: hash(attachment),
    });
    const stored = await f.mediaCtx.driver.get({ bucket: "original", key: object!.key });
    expect(new Uint8Array(await new Response(stored.body).arrayBuffer())).toEqual(attachment);
    const backupDb = new Client({ connectionString: testDatabaseUrl() });
    await backupDb.connect();
    try {
      const originals = await readOriginalManifest(backupDb);
      expect(originals.filter(entry => entry.sha256 === hash(attachment))).toEqual([
        expect.objectContaining({ id: object!.id, key: object!.key, size: attachment.length }),
      ]);
    } finally { await backupDb.end(); }
    const rollback = Error("ROLLBACK_FIXTURE");
    await expect(f.ctx.db.transaction(async tx => {
      await tx.update(blobs).set({ state: "deleted" }).where(eq(blobs.id, sourceIds[0]!));
      expect(await originalHasDependencies(tx, object!.id)).toBe(true);
      await tx.update(blobs).set({ state: "deleted" }).where(eq(blobs.id, sourceIds[1]!));
      expect(await originalHasDependencies(tx, object!.id)).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
    const empty = await f.ctx.db.select().from(chartSourceEntries).where(eq(chartSourceEntries.sourceBlobId, sourceIds[0]!));
    expect(empty.find(ref => ref.path === "song/empty.txt")).toMatchObject({ contentBlobId: null, size: 0 });
  }, 60_000);
  test("retries a lost CAS PUT response without duplicating the object or publishing a partial manifest", async () => {
    const content = strToU8(`uncertain ${crypto.randomUUID()}`);
    const sha256 = hash(content);
    const u = await upload(zipSync({
      "maidata.txt": strToU8("&title=CAS recovery\n&inote_4=(120){4}1,2,E\n"),
      "attachment.md": content,
    }));
    await ingestUpload(f.mediaCtx, u.data);
    const fault = {
      ...f.mediaCtx,
      driver: {
        ...f.mediaCtx.driver,
        async put(input: Parameters<typeof f.mediaCtx.driver.put>[0]) {
          const result = await f.mediaCtx.driver.put(input);
          if (input.bucket === "original" && input.sha256 === sha256) throw new Error("LOST_FIXTURE_CAS_PUT");
          return result;
        },
      },
    };
    await expect(handleChartImport(fault, u.data)).rejects.toThrow("LOST_FIXTURE_CAS_PUT");
    const [file] = await f.ctx.db.select().from(files).where(eq(files.id, u.dto.fileId!));
    const [pending] = await f.ctx.db.select().from(blobs).where(eq(blobs.sha256, sha256));
    expect(pending?.state).toBe("pending");
    expect(await f.ctx.db.select().from(chartSourceEntries).where(eq(chartSourceEntries.sourceBlobId, file!.blobId))).toHaveLength(0);
    await f.ctx.db.update(blobs).set({ leaseUntil: new Date(0) }).where(eq(blobs.id, pending!.id));
    await handleChartImport(f.mediaCtx, u.data);
    await finalizeUpload(f.mediaCtx, u.data);
    const refs = await f.ctx.db.select().from(chartSourceEntries).where(eq(chartSourceEntries.sourceBlobId, file!.blobId));
    expect(refs).toHaveLength(2);
    expect(refs.find(ref => ref.sha256 === sha256)?.contentBlobId).toBe(pending!.id);
    const [ready] = await f.ctx.db.select().from(blobs).where(eq(blobs.id, pending!.id));
    expect(ready).toMatchObject({ state: "ready", leaseUntil: null, size: content.length });
  }, 30_000);
  test("chart import dead delivery rejects once and releases its reservation and File", async()=>{
    const u = await upload(zipSync({"maidata.txt":strToU8("&inote_4=(120){4}1,E")},{level:0}));
    const [session] = await f.ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id,u.dto.id));
    const dead = {sourceName:"media.chart-import",sourceId:session.flowJobIds[1],data:u.data};
    expect(await recordStorageDead(f.mediaCtx,dead)).toBe(true);
    expect(await recordStorageDead(f.mediaCtx,dead)).toBe(false);
    expect(await getUpload(f.ctx,u.userId,u.dto.id)).toMatchObject({state:"rejected",errorCode:"PROCESSING_FAILED"});
    expect((await f.ctx.db.select().from(files).where(eq(files.id,u.dto.fileId!)))[0]).toMatchObject({state:"rejected",retainedUntil:expect.any(Date)});
    expect((await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,u.userId)))[0])
      .toMatchObject({usedBytes:0,reservedBytes:0,activeUploads:0});
  });
  test("a running chart child observes cancellation, is reaped, and frees the shared native slot", async()=>{
    const bytes = zipSync({"maidata.txt":strToU8(`&inote_4=(120){64}${"1,".repeat(99_000)}E`)},{level:0});
    const u = await upload(bytes);
    await ingestUpload(f.mediaCtx,u.data);
    const source = (await claimRecipe(f.mediaCtx,u.data,"chart-source"))!;
    const directory = await mkdtemp(join(f.mediaCtx.config.tempDir,"chart-cancel-test-"));
    const watcher = await watchProcessingUpload(f.mediaCtx,u.data,AbortSignal.timeout(10_000));
    const states: string[] = [];
    let canceling: Promise<void> | undefined;
    try {
      const input = join(directory,"input.zip"), output = join(directory,"preview");
      await Bun.write(input,bytes);
      // Cancellation must race a valid import, not a duration-limit rejection.
      const valid = await processChart(input,output);
      expect(valid.summary.difficulties[0].noteCount).toBe(99_000);
      expect(valid.summary.difficulties[0].durationMs).toBeLessThan(3_600_000);
      await rm(output);
      const child = processChart(input,output,watcher.signal,state=>{
        states.push(state);
        if(state === "started") canceling = (async()=>{
          await cancelUpload(f.ctx,u.userId,u.dto.id); await watcher.check();
        })();
      });
      await expect(child).rejects.toMatchObject({code:"UPLOAD_CANCELLED"});
      await canceling;
      expect(states).toEqual(["started","reaped"]);
      await expect(stat(output)).rejects.toMatchObject({code:"ENOENT"});
      expect(await claimRecipeOutput(f.mediaCtx,u.data,source,{hash:"0".repeat(64),size:1,mime:CHART_PREVIEW_MIME,properties:{chartPreview:{}}})).toBeNull();
      await releaseRecipeComputation(f.mediaCtx,{...source,recipe:{...source.recipe,generation:source.recipe.generation-1}});
      expect((await f.ctx.db.select().from(blobDerivatives).where(eq(blobDerivatives.id,source.recipe.id)))[0].leaseUntil).not.toBeNull();
      await releaseRecipeComputation(f.mediaCtx,source);
      expect((await f.ctx.db.select().from(blobDerivatives).where(eq(blobDerivatives.id,source.recipe.id)))[0].leaseUntil).toBeNull();
      await cancelUpload(f.ctx,u.userId,u.dto.id);
      const [file] = await f.ctx.db.select().from(files).where(eq(files.id,u.dto.fileId!));
      expect(file).toMatchObject({state:"rejected",retainedUntil:expect.any(Date)});
      expect((await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,u.userId)))[0])
        .toMatchObject({usedBytes:0,reservedBytes:0,activeUploads:0});
      expect(await recordStorageDead(f.mediaCtx,{sourceName:"media.chart-import",sourceId:u.dto.id,data:u.data})).toBe(false);
      // A new real child can enter only after the cancelled process has exited.
      await Bun.write(input,zipSync({"maidata.txt":strToU8("&inote_4=(120){4}1,E")},{level:0}));
      expect((await processChart(input,output)).summary.difficulties[0].previewSupported).toBe(true);
    } finally { watcher.stop(); await rm(directory,{recursive:true,force:true}); }
  },20_000);
});
