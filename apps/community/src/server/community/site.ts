import { and, asc, desc, eq, lt, gt, or, inArray, sql } from "drizzle-orm";
import type { FeaturedState, NoticeDraft, NoticePage, PublicNotice, SiteNotice } from "@/shared/community-site";
import { noticeDraftSchema } from "@/shared/community-site";
import { communityNotices, communityContentStates, storageJournalProgress, chartPublicIds, user } from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import { StorageError } from "../storage/errors";
import { withStorageTransaction } from "../storage/transactions";
import { getPublicChartsByIds } from "../charts/publication";
import { awaitCommunityJournal, communityHash, readCommunityFact, recordCommunityFact } from "./content-journal";
import { UUID_PATTERN } from "../uuid";
import { isPublicChartId } from "@/shared/chart-public-id";
async function featuredCharts(ctx:StorageContext,ids:string[]) {
 if(!ids.length)return [];
 const keys=await ctx.db.select({id:chartPublicIds.chartId}).from(chartPublicIds).where(inArray(chartPublicIds.publicId,ids.map(id=>BigInt(id))));
 return getPublicChartsByIds(ctx,keys.map(row=>row.id));
}
async function activeActor(tx:Parameters<Parameters<StorageContext["db"]["transaction"]>[0]>[0],actor:string){
 const [row]=await tx.select({status:user.status}).from(user).where(eq(user.id,actor)).for("share");
 if(row?.status!=="active")throw new StorageError(403,"ACCOUNT_INACTIVE");
 await tx.execute(sql`select set_config('adxc.governance_actor',${actor},true)`);
}
const invalid = () => new StorageError(400,"SITE_INVALID");
const changed = () => new StorageError(409,"SITE_CHANGED");
function cursor(value:string|undefined,admin:boolean){
 if(!value)return null;
 if(value.length>600)throw invalid();
 try{const c=JSON.parse(Buffer.from(value,"base64url").toString("utf8"));if(c.scope!==(admin?"admin":"public")||!UUID_PATTERN.test(c.id)||!Number.isInteger(c.order)||c.order<0||c.order>1000||![0,1].includes(c.level))throw invalid();return c as {id:string;order:number;level:number};}catch{throw invalid();}
}
const noticeRank=sql<number>`case when ${communityNotices.publication}->>'level'='important' then 0 else 1 end`;
const noticeOrder=sql<number>`coalesce((${communityNotices.publication}->>'order')::int,0)`;
export async function listNotices(ctx:StorageContext, admin=false, after?:string):Promise<NoticePage<SiteNotice|PublicNotice>> {
 const at=cursor(after,admin), now=(ctx.now?.()??new Date()).toISOString();
 const [progress]=admin?await ctx.db.select().from(storageJournalProgress).where(eq(storageJournalProgress.id,"global")):[];
 const rows=await ctx.db.select({notice:communityNotices,state:communityContentStates}).from(communityNotices)
  .leftJoin(communityContentStates,eq(communityContentStates.key,sql`'notice:'||${communityNotices.id}::text`))
  .where(and(at?(admin?lt(communityNotices.id,at.id):or(gt(noticeRank,at.level),and(eq(noticeRank,at.level),gt(noticeOrder,at.order)),and(eq(noticeRank,at.level),eq(noticeOrder,at.order),lt(communityNotices.id,at.id)))):undefined,admin?undefined:sql`${communityNotices.publication} is not null
   and coalesce((${communityNotices.publication}->>'startsAt')::timestamptz,'-infinity'::timestamptz)<=${now}::timestamptz and coalesce((${communityNotices.publication}->>'expiresAt')::timestamptz,'infinity'::timestamptz)>${now}::timestamptz
   and ${communityContentStates.fact}->>'state'='visible' and ${communityContentStates.fact}->>'hash'=${communityNotices.publicationHash}
   and ${communityContentStates.journalSequence}<=coalesce((select exported_sequence from storage_journal_progress where id='global'),0)`))
  .orderBy(...(admin?[desc(communityNotices.id)]:[asc(noticeRank),asc(noticeOrder),desc(communityNotices.id)])).limit(21);
 const items=rows.slice(0,20).flatMap<SiteNotice|PublicNotice>(({notice,state})=>{
  if(admin){const terminal=state?.fact.state==="deleted"||state?.fact.state==="hidden";return [{...notice,revision:Math.max(notice.revision,state?.revision??0),withdrawn:notice.withdrawn||terminal,publication:terminal?null:notice.publication,publicationPending:Boolean(!terminal&&notice.publication&&(!state||state.fact.hash!==notice.publicationHash||state.journalSequence>(progress?.exportedSequence??0)))} as SiteNotice];}
  if(!notice.publication||!state||state.fact.state!=="visible"||state.fact.hash!==communityHash(notice.publication))return [];
  return [{id:notice.id,publication:notice.publication} as PublicNotice];
 });
 const last=rows[19]?.notice;
 return {items,nextCursor:rows.length>20&&last?Buffer.from(JSON.stringify({scope:admin?"admin":"public",id:last.id,order:last.publication?.order??0,level:last.publication?.level==="important"?0:1})).toString("base64url"):null};
}
export async function getNotice(ctx:StorageContext,id:string):Promise<SiteNotice>{
 if(!UUID_PATTERN.test(id))throw invalid();
 const [row]=await ctx.db.select().from(communityNotices).where(eq(communityNotices.id,id));
 if(!row)throw new StorageError(404,"NOT_FOUND");
 const fact=await readCommunityFact(ctx.db,"notice",id);
 const [progress]=await ctx.db.select().from(storageJournalProgress).where(eq(storageJournalProgress.id,"global"));
 const terminal=fact?.fact.state==="deleted"||fact?.fact.state==="hidden";
 return {...row,revision:Math.max(row.revision,fact?.fact.revision??0),withdrawn:row.withdrawn||terminal,publication:terminal?null:row.publication,publicationPending:Boolean(!terminal&&row.publication&&(!fact||fact.fact.hash!==row.publicationHash||fact.sequence>(progress?.exportedSequence??0)))};
}
export async function saveNotice(ctx:StorageContext,actor:string,id:string,input:{expectedRevision:number;draft?:NoticeDraft;action:"save"|"publish"|"withdraw"}) {
 if(!UUID_PATTERN.test(id))throw invalid();
 const outcome=await withStorageTransaction(ctx.db,async tx=>{
  await activeActor(tx,actor);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`notice:${id}`},218))`);
  const latest=await readCommunityFact(tx,"notice",id);
  let [row]=await tx.select().from(communityNotices).where(eq(communityNotices.id,id)).for("update");
  if(!row){
   if(latest||input.action!=="save"||input.expectedRevision!==0||!input.draft)throw changed();
   const draft=noticeDraftSchema.parse(input.draft);
   [row]=await tx.insert(communityNotices).values({id,draft}).returning();
   return {row,sequence:0};
  }
  if(latest&&["deleted","hidden"].includes(latest.fact.state)){
   if(input.action!=="withdraw")throw changed();
   await tx.update(communityNotices).set({publication:null,publicationHash:null,withdrawn:true,revision:Math.max(row.revision,latest.fact.revision)}).where(eq(communityNotices.id,id));
   return {row,sequence:latest.sequence};
  }
  // An old backup may contain the body at an older revision. An explicit new draft
  // can advance from the durable revision; the old publication stays hash-gated.
  row.revision=Math.max(row.revision,latest?.fact.revision??0);
  // Ambiguous write read-back/retry can return the already committed result, never repeat a new revision.
  if(row.revision!==input.expectedRevision){
   if(input.action==="save"&&input.draft&&communityHash(row.draft)===communityHash(noticeDraftSchema.parse(input.draft)))return {row,sequence:0};
   if(input.action==="publish"&&row.revision===input.expectedRevision+1&&row.publication&&!row.withdrawn){
    const {publishedAt:_,...publishedDraft}=row.publication;
    const prior=await readCommunityFact(tx,"notice",id);
    if(communityHash(publishedDraft)===communityHash(row.draft)&&prior?.fact.revision===row.revision&&prior.fact.state==="visible"&&prior.fact.hash===communityHash(row.publication))return {row,sequence:prior.sequence};
   }
   if(input.action==="withdraw"&&row.withdrawn){const old=await readCommunityFact(tx,"notice",id);return {row,sequence:old?.sequence??0};}
   throw changed();
  }
  if(row.withdrawn)throw changed();
  const revision=row.revision+1;
  if(input.action==="save"){
   if(!input.draft)throw invalid();
   const [next]=await tx.update(communityNotices).set({revision,draft:noticeDraftSchema.parse(input.draft)}).where(eq(communityNotices.id,id)).returning();
   return {row:next,sequence:0};
  }
  const publication=input.action==="publish"?{...noticeDraftSchema.parse(row.draft),publishedAt:(ctx.now?.()??new Date()).toISOString()}:null;
  const [next]=await tx.update(communityNotices).set({revision,publication,publicationHash:publication?communityHash(publication):null,withdrawn:input.action==="withdraw"}).where(eq(communityNotices.id,id)).returning();
  const sequence=await recordCommunityFact(tx,{version:1,entity:"notice",id,revision,state:publication?"visible":"deleted",...(publication?{hash:communityHash(publication)}:{})},actor);
  return {row:next,sequence};
 });
 await awaitCommunityJournal(ctx,outcome.sequence);
 return getNotice(ctx,id);
}
export async function getFeatured(ctx:StorageContext,admin=false):Promise<FeaturedState>{
 const state=await readCommunityFact(ctx.db,"featured","home");
 const [progress]=await ctx.db.select().from(storageJournalProgress).where(eq(storageJournalProgress.id,"global"));
 const ids=state&&(admin||state.sequence<=(progress?.exportedSequence??0))?state.fact.controls?.featured??[]:[];
 const visible=await featuredCharts(ctx,ids);
 const map=new Map(visible.map(chart=>[chart.publicId,chart]));
 return {revision:state?.fact.revision??0,ids:admin?ids:ids.filter(id=>map.has(id)),items:ids.flatMap(id=>map.has(id)?[map.get(id)!]:[])};
}
export async function setFeatured(ctx:StorageContext,actor:string,input:{expectedRevision:number;ids:string[]}){
 if(input.ids.length>6||new Set(input.ids).size!==input.ids.length||input.ids.some(id=>!isPublicChartId(id)))throw invalid();
 const sequence=await withStorageTransaction(ctx.db,async tx=>{
  await activeActor(tx,actor);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('featured:home',217))`);
  const prior=await readCommunityFact(tx,"featured","home");
  if((prior?.fact.revision??0)!==input.expectedRevision){
   if(JSON.stringify(prior?.fact.controls?.featured??[])===JSON.stringify(input.ids))return prior?.sequence??0;
   throw changed();
  }
  const available=await featuredCharts({...ctx,db:tx as unknown as StorageContext["db"]},input.ids);
  if(available.length!==input.ids.length)throw invalid();
  return recordCommunityFact(tx,{version:1,entity:"featured",id:"home",revision:input.expectedRevision+1,state:"control",controls:{featured:input.ids}},actor);
 });
 await awaitCommunityJournal(ctx,sequence);return getFeatured(ctx,true);
}
