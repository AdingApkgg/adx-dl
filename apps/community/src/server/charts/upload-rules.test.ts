import { beforeAll, afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { user, blobs, files, storageUsage, storagePolicies, uploadSessions } from "../db/schema";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { testSender } from "../testing/test-boss";
import { storageFixtureConfig, cleanupStorageFixture } from "../../../test/storage/fixture";
import { createLogger } from "@/shared/log";
import { initUpload, cancelUpload } from "../storage/uploads";
import { createS3Driver } from "../storage/s3";
import type { StorageContext } from "../storage/contracts";
import { chartUploadRule } from "./upload-rules";
let ctx: StorageContext;
let policyId: string;
const owners: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  const config = await storageFixtureConfig();
  ctx = { db:testDbHandle().db, boss:testSender, config, driver:createS3Driver(config), log:createLogger(()=>{}) };
  const [policy] = await ctx.db.insert(storagePolicies).values({name:`chart-quota-${crypto.randomUUID()}`,
    endpoint:config.endpoint,region:config.region,originalBucket:config.originalBucket,
    derivedBucket:config.derivedBucket,credentialsRef:config.credentialsRef}).returning();
  policyId = policy.id;
});
afterAll(async()=>{ if(ctx) await cleanupStorageFixture(ctx.db,owners,[policyId]); });
async function owner() {
  const id = crypto.randomUUID(); owners.push(id);
  await ctx.db.insert(user).values({id,name:"quota",email:`${id}@test.invalid`});
  return id;
}
const input = (size: number, purpose: "avatar"|"chart-source" = "chart-source") => ({
  purpose, name: purpose === "avatar" ? "photo.png" : "chart.zip", size,
  sha256:createHash("sha256").update(crypto.randomUUID()).digest("hex"),
});
async function readyFile(ownerId: string, purpose: "avatar"|"chart-source", size: number) {
  const sha256 = createHash("sha256").update(crypto.randomUUID()).digest("hex");
  const [blob] = await ctx.db.insert(blobs).values({sha256,size,policyId,key:`objects/${sha256}`,state:"ready",verifiedAt:new Date(),detectedMime:"application/zip"}).returning();
  await ctx.db.insert(files).values({ownerId,blobId:blob.id,size,purpose,originalName:"history.zip",state:"ready"});
  await ctx.db.insert(storageUsage).values({userId:ownerId,usedBytes:size});
}
test("chart limits reject oversize before sessions or physical IO",async()=>{
  const id = await owner();
  await expect(initUpload(ctx,id,input(chartUploadRule.maxSize+1),crypto.randomUUID())).rejects.toMatchObject({code:"FILE_TOO_LARGE"});
  expect(await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.ownerId,id))).toHaveLength(0);
});
test("purpose quotas count ready originals and reservations independently; active cap remains shared",async()=>{
  const id = await owner();
  await readyFile(id,"chart-source",chartUploadRule.quota-64);
  const avatar = await initUpload(ctx,id,input(8_388_608,"avatar"),crypto.randomUUID());
  const chart = await initUpload(ctx,id,input(64),crypto.randomUUID());
  await expect(initUpload(ctx,id,input(1),crypto.randomUUID())).rejects.toMatchObject({code:"QUOTA_EXCEEDED"});
  await cancelUpload(ctx,id,chart.id);
  const next = await initUpload(ctx,id,input(64),crypto.randomUUID());
  await expect(initUpload(ctx,id,input(1,"avatar"),crypto.randomUUID())).rejects.toMatchObject({code:"TOO_MANY_UPLOADS"});
  await cancelUpload(ctx,id,next.id); await cancelUpload(ctx,id,avatar.id);
  const [usage] = await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId,id));
  expect(usage).toMatchObject({usedBytes:chartUploadRule.quota-64,reservedBytes:0,activeUploads:0});
});
