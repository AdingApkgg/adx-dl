import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { user, storagePolicies, uploadSessions } from "../db/schema";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { testSender } from "../testing/test-boss";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { createLogger } from "../../shared/log";
import { createS3Driver } from "./s3";
import { initUpload, getUpload } from "./uploads";
import { putUploadPart } from "./parts";
import type { StorageContext } from "./contracts";
let ctx: StorageContext;
const owners: string[] = [], policies: string[] = [], written: number[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
 await resetTestDatabase();
 const config=await storageFixtureConfig();
 ctx={db:testDbHandle().db,config,boss:testSender,log:createLogger(()=>{}),driver:{...createS3Driver(config),put:async args=>{const bytes=new Uint8Array(await new Response(args.body).arrayBuffer());expect(bytes.length).toBe(args.size);expect(hash(bytes)).toBe(args.sha256);written.push(bytes.length);}}};
 const [p]=await ctx.db.insert(storagePolicies).values({name:crypto.randomUUID(),endpoint:config.endpoint,region:config.region,originalBucket:config.originalBucket,derivedBucket:config.derivedBucket,credentialsRef:config.credentialsRef}).returning();policies.push(p.id);
},30000);
afterAll(async()=>{if(ctx)await cleanupStorageFixture(ctx.db,owners,policies);},30000);
async function session(purpose:"avatar"|"chart-source",bytes:Uint8Array){const id=crypto.randomUUID();owners.push(id);await ctx.db.insert(user).values({id,name:"test",email:id+"@placeholder.invalid"});const key=crypto.randomUUID();const input={purpose,name:purpose==="avatar"?"photo.png":"chart.zip",size:bytes.length,sha256:hash(bytes)};return {id,key,input,upload:await initUpload(ctx,id,input,key)};}
test("new uploads negotiate 1 MiB parts while persisted 4 MiB sessions retain admission and replay",async()=>{
 for(const purpose of ["avatar","chart-source"] as const){
  const bytes=new Uint8Array(1048576+3);const f=await session(purpose,bytes);
  expect(f.upload.partSize).toBe(1048576);expect(f.upload.partCount).toBe(2);
  for(let index=0;index<2;index++){const part=bytes.subarray(index*f.upload.partSize,Math.min(bytes.length,(index+1)*f.upload.partSize));await putUploadPart(ctx,f.id,f.upload.id,index,part,hash(part));}
  expect((await getUpload(ctx,f.id,f.upload.id)).receivedParts.map(p=>p.size)).toEqual([1048576,3]);
 }
 const bytes=new Uint8Array(4194304+3);const legacy=await session("avatar",bytes);
 await ctx.db.update(uploadSessions).set({partSize:4194304,partCount:2}).where(eq(uploadSessions.id,legacy.upload.id));
 const resumed=await initUpload(ctx,legacy.id,legacy.input,legacy.key);
 expect(resumed.partSize).toBe(4194304);expect(resumed.partCount).toBe(2);
 for(let index=0;index<2;index++){const part=bytes.subarray(index*resumed.partSize,Math.min(bytes.length,(index+1)*resumed.partSize));await putUploadPart(ctx,legacy.id,resumed.id,index,part,hash(part));}
 expect((await getUpload(ctx,legacy.id,resumed.id)).receivedParts.map(p=>p.size)).toEqual([4194304,3]);
 expect(written).toEqual([1048576,3,1048576,3,4194304,3]);
},30000);
