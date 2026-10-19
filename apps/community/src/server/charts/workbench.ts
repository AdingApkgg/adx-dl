import {createHash} from "node:crypto";
import {and,desc,eq,isNull,sql} from "drizzle-orm";
import {HTTPException} from "hono/http-exception";
import type {WorkbenchFilters,WorkbenchPage,WorkbenchItem,VersionFingerprint,SourceBinding} from "@/shared/author-workbench";
import {charts,chartVersions,chartPublications,chartPublicIds,chartModerations,storageJournalProgress,files,blobs,user} from "../db/schema";
import type {StorageContext} from "../storage/contracts";
import {StorageError} from "../storage/errors";
import {UUID_PATTERN} from "../uuid";
import {getChart,publicationDto} from "./service";
import {chartUploadRule,usageByPurpose} from "./upload-rules";
import {resolveChartAsset} from "./assets";
const missing=()=>new StorageError(404,"NOT_FOUND");
const invalid=()=>new HTTPException(400,{message:"Invalid workbench request"});
export async function listWorkbench(ctx:StorageContext,ownerId:string,input:WorkbenchFilters={}):Promise<WorkbenchPage>{
 const q=(input.q??"").trim(),status=input.status??"all";
 if((input.q?.length??0)>240||[...q].length>120||/[\p{Cc}]/u.test(q)||!["all","draft","published","hidden"].includes(status))throw invalid();
 const filterKey=createHash("sha256").update(JSON.stringify({ownerId,q,status,changed:!!input.changed,warnings:!!input.warnings,pending:!!input.pending})).digest("hex");
 let cursor:{id:string;at:string;key:string}|undefined;
 if(input.cursor){try{if(input.cursor.length>512)throw invalid();cursor=JSON.parse(Buffer.from(input.cursor,"base64url").toString());if(!cursor||cursor.key!==filterKey||!UUID_PATTERN.test(cursor.id)||new Date(cursor.at).toISOString()!==cursor.at)throw invalid();}catch{throw invalid();}}
 return ctx.db.transaction(async tx=>{
  const [active]=await tx.select({id:user.id}).from(user).where(and(eq(user.id,ownerId),eq(user.status,"active")));
  if(!active)throw new StorageError(403,"ACCOUNT_INACTIVE");
  // Existing admission caps each owner at50 charts/20 versions. No media read or per-chart parsing.
  const rows=await tx.select({chart:charts,version:chartVersions,publication:chartPublications,identity:chartPublicIds,moderation:chartModerations,
    versionCount:sql<number>`(select count(*)::integer from chart_versions v where v.chart_id=${charts.id} and v.deleted_at is null)`})
   .from(charts).innerJoin(chartVersions,and(eq(chartVersions.id,charts.currentVersionId),eq(chartVersions.chartId,charts.id),isNull(chartVersions.deletedAt)))
   .leftJoin(chartPublications,eq(chartPublications.chartId,charts.id)).leftJoin(chartPublicIds,eq(chartPublicIds.chartId,charts.id))
   .leftJoin(chartModerations,eq(chartModerations.chartId,charts.id))
   .where(and(eq(charts.ownerId,ownerId),isNull(charts.deletedAt))).orderBy(desc(charts.updatedAt),desc(charts.id)).limit(50);
  const [progress]=await tx.select().from(storageJournalProgress).where(eq(storageJournalProgress.id,"global"));
  const items:WorkbenchItem[]=rows.map(({chart,version,publication,identity,moderation,versionCount})=>{
   const pub=publication?publicationDto(publication):null;
   const changed=!!pub&&(pub.versionId!==chart.currentVersionId||pub.title!==chart.title||pub.artist!==chart.artist||pub.description!==chart.description||pub.credits!==chart.credits||JSON.stringify(pub.tags)!==JSON.stringify(chart.tags)||pub.releaseNote!==version.releaseNote);
   return {id:chart.id,title:chart.title,artist:chart.artist,description:chart.description,credits:chart.credits,tags:chart.tags,revision:chart.revision,currentVersionId:chart.currentVersionId!,updatedAt:chart.updatedAt.toISOString(),publicId:identity?.publicId.toString()??null,
    publication:pub,publicationPending:chart.publicationSequence>(progress?.exportedSequence??0),summary:version.summary,currentOrdinal:version.ordinal,versionCount:Number(versionCount),warningCount:version.summary.warnings.length,changed,moderated:!!moderation};
  });
  const counts={total:items.length,private:items.filter(i=>!i.publication).length,published:items.filter(i=>i.publication).length,changed:items.filter(i=>i.changed).length,warnings:items.filter(i=>i.warningCount).length,pending:items.filter(i=>i.publicationPending).length,hidden:items.filter(i=>i.moderated).length};
  const filtered=items.filter(i=>(!q||`${i.title}\n${i.artist}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()))&&(status==="all"||(status==="draft"&&!i.publication)||(status==="published"&&!!i.publication)||(status==="hidden"&&i.moderated))&&(!input.changed||i.changed)&&(!input.warnings||i.warningCount>0)&&(!input.pending||i.publicationPending));
  const after=cursor?filtered.filter(i=>i.updatedAt<cursor!.at||(i.updatedAt===cursor!.at&&i.id<cursor!.id)):filtered;
  const page=after.slice(0,20),last=page.at(-1);
  return {items:page,nextCursor:after.length>20&&last?Buffer.from(JSON.stringify({id:last.id,at:last.updatedAt,key:filterKey})).toString("base64url"):null,counts,
   targets:items.map(i=>({id:i.id,title:i.title,revision:i.revision,versionCount:i.versionCount})),usage:{...await usageByPurpose(tx,ownerId,"chart-source"),quotaBytes:chartUploadRule.quota}};
 },{isolationLevel:"repeatable read",accessMode:"read only"});
}
export async function versionFingerprint(ctx:StorageContext,ownerId:string,chartId:string,versionId:string):Promise<VersionFingerprint>{
 if(!UUID_PATTERN.test(versionId))throw missing();
 const chart=await getChart(ctx,ownerId,chartId),version=chart.versions.find(v=>v.id===versionId);
 if(!version)throw missing();
 const [source]=await ctx.db.select({sha256:blobs.sha256,size:files.size}).from(files).innerJoin(blobs,eq(blobs.id,files.blobId))
  .where(and(eq(files.id,version.sourceFileId),eq(files.ownerId,ownerId),eq(files.state,"ready"),isNull(files.deletedAt),eq(blobs.state,"ready")));
 if(!source)throw missing();
 const assets:VersionFingerprint["assets"]={};
 const roles=["maidata",...(version.summary.audio?["audio"]:[]),...(version.summary.hasCover?["cover"]:[])] as const;
 for(const role of roles){const asset=await resolveChartAsset(ctx,ownerId,chartId,versionId,role);assets[role as keyof typeof assets]={sha256:asset.sha256,size:asset.size,mime:asset.mime};}
 return {versionId,source,assets};
}
export async function sourceBinding(ctx:StorageContext,ownerId:string,fileId:string):Promise<SourceBinding>{
 if(!UUID_PATTERN.test(fileId))throw missing();
 const [file]=await ctx.db.select({file:files}).from(files).innerJoin(user,and(eq(user.id,files.ownerId),eq(user.status,"active"))).where(and(eq(files.id,fileId),eq(files.ownerId,ownerId),eq(files.purpose,"chart-source")));
 if(!file)throw missing();
 const [bound]=await ctx.db.select({chart:charts,version:chartVersions}).from(chartVersions).innerJoin(charts,eq(charts.id,chartVersions.chartId)).where(eq(chartVersions.sourceFileId,fileId));
 if(bound){if(bound.chart.ownerId!==ownerId||bound.chart.deletedAt||bound.version.deletedAt)return {state:"unavailable"};return {state:"bound",chartId:bound.chart.id,versionId:bound.version.id};}
 return file.file.deletedAt||file.file.state!=="ready"?{state:"unavailable"}:{state:"unbound"};
}
