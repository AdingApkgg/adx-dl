import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { eq, sql } from "drizzle-orm";
import { ingestFixture, hash } from "../../test/storage/ingest-fixture";
import { blobDerivatives, derivedObjects, files, storageBudget, storageUsage, uploadSessions } from "../server/db/schema";
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
import { createBoss } from "../server/jobs/boss";
import { registerMediaWorkers } from "./main";
import { watchProcessingUpload } from "./upload-cancellation";
import { processChart } from "./chart-child";
import { recordStorageDead } from "../worker/storage-sweep";
import { claimRecipe, claimRecipeOutput, releaseRecipeComputation } from "../server/storage/objects";
import { CHART_PREVIEW_MIME } from "../server/charts/recipe";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
describe.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH && !process.env.STORAGE_TEST_MEDIA_ACCESS_KEY_ID)("private chart import on isolated PG and authenticated S3",()=>{
  let f: Awaited<ReturnType<typeof ingestFixture>>;
  beforeAll(async()=>{await resetTestDatabase();f=await ingestFixture();f.mediaCtx.config.recipeBuild=RECIPE_BUILD;},30_000);
  afterAll(async()=>{await f?.cleanup();},30_000);
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
      expect(result?.state).toBe("ready");
      expect(await getFile(f.ctx,u.userId,u.dto.fileId!)).toMatchObject({purpose:"chart-source",state:"ready"});
      const [usage] = await f.ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,u.userId));
      expect(usage).toMatchObject({usedBytes:bytes.length,reservedBytes:0,activeUploads:0});
    } finally { await worker.stop({graceful:true,timeout:5_000}); }
  },30_000);
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
