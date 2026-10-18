import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { ChartImportSummary, ChartPreviewManifest } from "../../src/shared/charts";
import { blobs,blobDerivatives,derivedObjects,files,storageUsage,storageBudget } from "../../src/server/db/schema";
import { chartManifestBytes } from "../../src/server/charts/artifact";
import { recipeBuildFor,CHART_PREVIEW_MIME } from "../../src/server/charts/recipe";
import type { readyContext } from "./ready-file";
export function followingChartFiles(f:Awaited<ReturnType<typeof readyContext>>) {
 const objects=new Map<string,{size:number;sha256:string;mime:string}>();
 f.ctx.driver={...f.ctx.driver,async head({key}){return objects.get(key)??null;}};
 return async(ownerId:string,title="Following fixture")=>{
  const original=Buffer.from(crypto.randomUUID()),maidata=Buffer.from(`&title=${title}\n&inote_4=(120){4}1,2,E\n${crypto.randomUUID()}`);
  const hash=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
  const summary:ChartImportSummary={title,artist:"Fixture",maidataMd5Base64:createHash("md5").update(maidata).digest("base64"),difficulties:[{difficulty:4,level:"1",noteCount:2,durationMs:1000,previewSupported:true}],warnings:[],audio:null,hasCover:false};
  const manifest:ChartPreviewManifest={format:1,assets:[{role:"maidata",path:"maidata.txt",mime:"text/plain; charset=utf-8",size:maidata.length,sha256:hash(maidata),offset:0}],summary};
  const metadata=chartManifestBytes(manifest),header=Buffer.alloc(12);header.write("ADXCPV1\0","ascii");header.writeUInt32LE(metadata.length,8);
  const artifact=Buffer.concat([header,metadata,maidata]);
  const [blob]=await f.ctx.db.insert(blobs).values({policyId:f.policy.id,sha256:hash(original),key:`sha256/${hash(original)}`,size:original.length,state:"ready",detectedMime:"application/zip",verifiedAt:new Date()}).returning();
  const [output]=await f.ctx.db.insert(derivedObjects).values({policyId:f.policy.id,outputSha256:hash(artifact),key:`sha256/${hash(artifact)}`,size:artifact.length,mime:CHART_PREVIEW_MIME,state:"ready",properties:{chartPreview:manifest}}).returning();
  await f.ctx.db.insert(blobDerivatives).values({sourceBlobId:blob.id,recipe:"chart-preview-v1",recipeBuild:recipeBuildFor(f.ctx,"chart-source"),derivedObjectId:output.id,state:"ready"});
  const [file]=await f.ctx.db.insert(files).values({ownerId,blobId:blob.id,originalName:"fixture.zip",purpose:"chart-source",size:original.length,state:"ready",retainedUntil:new Date(Date.now()+86400000)}).returning();
  await f.ctx.db.insert(storageUsage).values({userId:ownerId,usedBytes:file.size}).onConflictDoUpdate({target:storageUsage.userId,set:{usedBytes:sql`${storageUsage.usedBytes}+${file.size}`}});
  await f.ctx.db.update(storageBudget).set({originalWritten:sql`${storageBudget.originalWritten}+${file.size}`,derivedWritten:sql`${storageBudget.derivedWritten}+${output.size}`}).where(eq(storageBudget.id,"global"));
  objects.set(blob.key,{size:blob.size,sha256:blob.sha256,mime:"application/zip"});objects.set(output.key,{size:output.size,sha256:output.outputSha256,mime:output.mime});
  return file;
 };
}
