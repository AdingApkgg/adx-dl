import { sql, type SQL } from "drizzle-orm";
import { isPublicChartId } from "@/shared/chart-public-id";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client";
import type { DbTransaction, StorageContext } from "../storage/contracts";
import { StorageError } from "../storage/errors";
import { withSocialUser } from "../services/social-page";
import { awaitCommunityJournal, communityHash, readCommunityFact, recordCommunityFact } from "../community/content-journal";
import { getPublicChart } from "../charts/publication";
import type { StorageErrorCode } from "@/shared/storage";
import type { CommunityContentFact } from "@/shared/community-content-journal";
import type { DiscussionAuthor, DiscussionMessage, ForumTopic } from "@/shared/discussions";
import type { PublicChartDto } from "@/shared/charts";
export type Handle = Db | DbTransaction;
export type TopicRow = { id:string; author_id:string|null; public_id:string; board_id:string; title:string|null; body:string|null; content_hash:string; revision:number; control_revision:number; state:string; locked:boolean; pin:number|null; linked_chart_ids:string[]; created_at:Date; edited_at:Date|null; reply_count?:number; activity_at?:Date };
export type MessageRow = { id:string; author_id:string|null; topic_id:string|null; chart_id:string|null; version_id:string|null; root_id:string|null; reply_to_id:string|null; body:string|null; content_hash:string; revision:number; state:string; difficulty:number|null; timestamp_ms:number|null; created_at:Date; edited_at:Date|null };
export async function rows<T>(db:Handle, query:SQL):Promise<T[]> { return (await db.execute(query)).rows as T[]; }
export const missing = () => new StorageError(404,"NOT_FOUND");
export const conflict = (code:StorageErrorCode="DISCUSSION_CHANGED") => new StorageError(409,code);
export const limited = () => new StorageError(429,"DISCUSSION_LIMIT","DISCUSSION_LIMIT",60);
// biome-ignore lint/suspicious/noControlCharactersInRegex: Deliberately reject control characters before storing untrusted text.
export function plain(value:string,max:number) { const v=value.trim(); if([...v].length<1||[...v].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(v)) throw new HTTPException(400); return v; }
export const stamp = (date:Date) => new Date(date).toISOString();
export const exported = sql`coalesce((select exported_sequence from storage_journal_progress where id='global'),0)`;
/** All list/count/search/activity queries use this same exported-fact boundary. */
export function visible(entity:"topic"|"message",alias:string):SQL {
 const a=sql.raw(alias);
 return sql`${a}.state='visible' and ${a}.body is not null and exists(select 1 from "user" u where u.id=${a}.author_id and u.status='active') and exists(select 1 from community_content_states s where s.key=${entity}||':'||${a}.id::text and s.fact->>'state'='visible' and s.revision=${a}.revision and s.fact->>'hash'=${a}.content_hash and s.journal_sequence<=${exported})`;
}
export const topicControl = (a="t") => sql`exists(select 1 from community_content_states c where c.key='topic_control:'||${sql.raw(a)}.id::text and c.journal_sequence<=${exported} and c.fact->>'state'='control')`;
export function topicAllowed(a="t"):SQL { return sql`${sql.raw(a)}.state<>'hidden' and ${sql.raw(a)}.state<>'deleted' and not exists(select 1 from community_content_states h where h.key='topic:'||${sql.raw(a)}.id::text and h.fact->>'state' in ('hidden','deleted')) and ${topicControl(a)}`; }
export const effectiveBoard = (a="t") => sql`(select c.fact->'controls'->>'board' from community_content_states c where c.key='topic_control:'||${sql.raw(a)}.id::text)`;
export const effectivePin = (a="t") => sql`(select (c.fact->'controls'->>'pin')::int from community_content_states c where c.key='topic_control:'||${sql.raw(a)}.id::text)`;
export function topicHash(t:Pick<TopicRow,"title"|"body"|"linked_chart_ids">) { return communityHash({title:t.title,body:t.body,chartIds:t.linked_chart_ids}); }
export function messageHash(m:Pick<MessageRow,"body"|"difficulty"|"timestamp_ms"|"root_id"|"reply_to_id"|"topic_id"|"chart_id"|"version_id">) { return communityHash({body:m.body,difficulty:m.difficulty,timestampMs:m.timestamp_ms,rootId:m.root_id,replyToId:m.reply_to_id,topicId:m.topic_id,chartId:m.chart_id,versionId:m.version_id}); }
export async function factMatches(db:Handle,entity:"topic"|"message",r:TopicRow|MessageRow) {
 const f=await readCommunityFact(db,entity,r.id);
 if(!f || f.fact.state!=="visible" || f.fact.revision!==r.revision || f.fact.hash!==r.content_hash || r.state!=="visible" || !r.body) return false;
 const [barrier]=await rows<{n:number}>(db,sql`select ${exported} n`);
 if(f.sequence>Number(barrier?.n??0)) return false;
 return f.fact.hash===(entity==="topic"?topicHash(r as TopicRow):messageHash(r as MessageRow));
}
export async function author(db:Handle,id:string|null):Promise<DiscussionAuthor|null> {
 if(!id) return null;
 const [a]=await rows<{id:string;name:string;image:string|null;public_id:string|null}>(db,sql`select u.id,u.name,u.image,case when p.journal_sequence<=${exported} then p.public_id::text end public_id from "user" u left join user_public_ids p on p.user_id=u.id where u.id=${id} and u.status='active'`);
 return a?{id:a.id,name:a.name,image:a.image,publicId:a.public_id}:null;
}
export async function boardWritable(tx:Handle,id:string) {
 const [b]=await rows<{read_only:boolean}>(tx,sql`select b.read_only from discussion_boards b where b.id=${id} for share`);
 if(!b) throw missing();
 const f=await readCommunityFact(tx,"board_control",id);
 const [barrier]=await rows<{n:number}>(tx,sql`select ${exported} n`);
 if(f && (f.sequence>Number(barrier?.n??0)||f.fact.controls?.readOnly)) throw conflict("DISCUSSION_READ_ONLY");
 if(!f && b.read_only) throw conflict("DISCUSSION_READ_ONLY");
}
export async function topicRow(db:Handle,publicId:string,lock=false) {
 if(!isPublicChartId(publicId)) throw missing();
 const [t]=await rows<TopicRow>(db,sql`select t.*,p.public_id::text from discussion_topics t join forum_public_ids p on p.topic_id=t.id where p.public_id=${publicId}::bigint and p.journal_sequence<=${exported} ${lock?sql`for update of t`:sql``}`);
 if(!t) throw missing(); return t;
}
export async function permittedTopic(ctx:StorageContext,publicId:string,viewer?:string,write=false,tx:Handle=ctx.db) {
 const t=await topicRow(tx,publicId,write);
 const f=await readCommunityFact(tx,"topic",t.id),c=await readCommunityFact(tx,"topic_control",t.id);
 const [barrier]=await rows<{n:number}>(tx,sql`select ${exported} n`); const barrierNumber=Number(barrier?.n??0);
 if(t.state==="hidden"||t.state==="deleted"||!c||c.sequence>barrierNumber||["hidden","deleted"].includes(f?.fact.state??"")) throw missing();
 t.revision=Math.max(t.revision,f?.fact.revision??0); t.board_id=c.fact.controls?.board??t.board_id; t.locked=!!c.fact.controls?.locked; t.pin=c.fact.controls?.pin??null; t.control_revision=c.fact.revision;
 const available=await factMatches(tx,"topic",t)&&!!await author(tx,t.author_id);
 const permanent=t.state==="root_removed"||f?.fact.state==="root_removed"||!!c.fact.controls?.removedRoot;
 if(!write&&!available){const [child]=await rows(tx,sql`select m.id from discussion_messages m where m.topic_id=${t.id}::uuid and ${visible("message","m")} limit 1`);const canRepair=!permanent&&viewer===t.author_id&&!!await author(tx,t.author_id);if(!child&&!canRepair)throw missing();}
 if(write) {
  if(permanent||t.locked) throw conflict("DISCUSSION_LOCKED");
  // Hold the root owner's active status until this write commits. Pending deletion
  // takes an incompatible user-row lock and must serialize before or after us.
  const [parent]=await rows(tx,sql`select id from "user" where id=${t.author_id} and status='active' for share`);
  if(!parent) throw conflict("DISCUSSION_ROOT_UNAVAILABLE");
  await boardWritable(tx,t.board_id);
  if(!available&&viewer!==t.author_id) throw conflict("DISCUSSION_ROOT_UNAVAILABLE");
 }
 return {t,available,permanent};
}
export async function chartCurrent(ctx:StorageContext,id:string,version?:string) { const chart=await getPublicChart(ctx,id); if(version&&chart.versionId!==version.toLowerCase()) throw conflict("DISCUSSION_VERSION_CHANGED"); return chart; }
export async function chartInTx(tx:Handle,c:PublicChartDto) {
 const [p]=await rows<{v:string;owner_id:string|null}>(tx,sql`select p.version_id v,c.owner_id from chart_publications p join charts c on c.id=p.chart_id left join "user" u on u.id=c.owner_id where p.chart_id=${c.id}::uuid and p.version_id=${c.versionId}::uuid and c.deleted_at is null and (c.owner_id is null or u.status='active') and not exists(select 1 from chart_moderations m where m.chart_id=c.id) for share of c,p`);
 if(!p) throw conflict("DISCUSSION_VERSION_CHANGED");
 if(p.owner_id!==null) {
  const [parent]=await rows(tx,sql`select id from "user" where id=${p.owner_id} and status='active' for share`);
  if(!parent) throw conflict("DISCUSSION_VERSION_CHANGED");
 }
}
export function timing(chart:PublicChartDto,difficulty:number|null,timestampMs:number|null) {
 if(difficulty===null) { if(timestampMs!==null) throw new HTTPException(400); return; }
 const d=chart.summary.difficulties.find(x=>x.difficulty===difficulty); if(!d) throw new HTTPException(400);
 if(timestampMs!==null&&(!d.previewSupported||d.durationMs===null||timestampMs<0||timestampMs>d.durationMs)) throw new HTTPException(400);
}
export async function messageDto(ctx:StorageContext,r:MessageRow,chart?:PublicChartDto):Promise<DiscussionMessage> {
 const a=await author(ctx.db,r.author_id); const ok=!!a&&await factMatches(ctx.db,"message",r);
 let quote:DiscussionMessage["quote"]=null;
 if(ok&&r.reply_to_id) { const [q]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${r.reply_to_id}::uuid and topic_id is not distinct from ${r.topic_id}::uuid and chart_id is not distinct from ${r.chart_id}::uuid and version_id is not distinct from ${r.version_id}::uuid`); if(q&&await factMatches(ctx.db,"message",q)) {const qa=await author(ctx.db,q.author_id); if(qa) quote={author:qa,text:[...(q.body??"")].slice(0,80).join("")};} }
 let effectiveDifficulty=r.difficulty;if(r.root_id){const [root]=await rows<{difficulty:number|null}>(ctx.db,sql`select difficulty from discussion_messages where id=${r.root_id}::uuid and chart_id=${r.chart_id}::uuid and version_id=${r.version_id}::uuid`);effectiveDifficulty=root?.difficulty??r.difficulty;}const d=chart?.summary.difficulties.find(d=>d.difficulty===effectiveDifficulty);
 return {id:r.id,rootId:r.root_id,replyToId:r.reply_to_id,body:ok?r.body:null,format:"plain",author:ok?a:null,createdAt:stamp(r.created_at),editedAt:ok&&r.edited_at?stamp(r.edited_at):null,revision:r.revision,state:ok?"visible":"unavailable",difficulty:effectiveDifficulty,timestampMs:ok?r.timestamp_ms:null,locatable:ok&&r.timestamp_ms!==null&&!!d?.previewSupported&&d.durationMs!==null&&r.timestamp_ms<=d.durationMs,publisher:ok&&!!chart&&chart.author?.id===a?.id,quote};
}
export async function topicDto(ctx:StorageContext,t:TopicRow,viewer?:string):Promise<ForumTopic> {
 const resolved=await permittedTopic(ctx,t.public_id,viewer); t=resolved.t;
 const a=resolved.available?await author(ctx.db,t.author_id):null;
 const [stats]=await rows<{n:number;at:Date|null}>(ctx.db,sql`select count(*)::int n,max(m.created_at) at from discussion_messages m where m.topic_id=${t.id}::uuid and ${visible("message","m")}`);
 const links=await Promise.all(t.linked_chart_ids.map(id=>getPublicChart(ctx,id).catch(error=>{if(error instanceof StorageError&&error.status===404)return null; throw error;})));
 const [sub]=viewer?await rows(ctx.db,sql`select 1 from discussion_subscriptions where user_id=${viewer} and topic_id=${t.id}::uuid`):[];
 return {canRestore:!resolved.available&&!resolved.permanent&&viewer===t.author_id&&!!await author(ctx.db,t.author_id)&&!t.locked,id:t.id,publicId:t.public_id,boardId:t.board_id,title:resolved.available?t.title:null,body:resolved.available?t.body:null,format:"limited_markdown",author:a,revision:t.revision,controlRevision:t.control_revision,createdAt:stamp(t.created_at),editedAt:resolved.available&&t.edited_at?stamp(t.edited_at):null,activityAt:stamp(stats?.at??t.created_at),replyCount:stats?.n??0,locked:t.locked||!resolved.available||resolved.permanent,pin:resolved.available?t.pin:null,state:resolved.permanent?"root_removed":resolved.available?"visible":"unavailable",subscribed:!!sub,linkedCharts:resolved.available?links:[]};
}
export function page(cursor:string|undefined,scope:unknown,ascending=false) {
 const hash=communityHash(scope); let c:{at:string;id:string;scope:string}|undefined;
 if(cursor) { try {if(cursor.length>600||!/^[\w-]+$/.test(cursor))throw 0;c=JSON.parse(Buffer.from(cursor,"base64url").toString());if(!c||Object.keys(c).sort().join()!=="at,id,scope"||c.scope!==hash||!/^[\da-f-]{36}$/i.test(c.id)||new Date(c.at).toISOString()!==c.at)throw 0;}catch{throw conflict("DISCUSSION_CURSOR_CHANGED");} }
 return {condition:(at:SQL,id:SQL)=>c?(ascending?sql`(${at},${id})>(${c.at}::timestamptz,${c.id}::uuid)`:sql`(${at},${id})<(${c.at}::timestamptz,${c.id}::uuid)`):sql`true`,encode:(at:Date,id:string)=>Buffer.from(JSON.stringify({at:stamp(at),id,scope:hash})).toString("base64url")};
}
export async function contentFact(tx:DbTransaction,entity:"topic"|"message",r:TopicRow|MessageRow,state:CommunityContentFact["state"]="visible") {
 return recordCommunityFact(tx,{version:1,entity,id:r.id,revision:r.revision,state,...(state==="visible"?{hash:r.content_hash,authorId:r.author_id??undefined}:{})},r.author_id??undefined);
}
export async function controlFact(tx:DbTransaction,t:TopicRow) {return recordCommunityFact(tx,{version:1,entity:"topic_control",id:t.id,revision:t.control_revision,state:"control",controls:{board:t.board_id,locked:t.locked,pin:t.pin??undefined,removedRoot:t.state==="root_removed"}},t.author_id??undefined);}
export async function editBudget(tx:DbTransaction,id:string) {const [c]=await rows<{n:number}>(tx,sql`select count(*)::int n from discussion_edits where entity_id=${id}::uuid and created_at>clock_timestamp()-interval '1 minute'`);if(c.n>=5)throw limited();await tx.execute(sql`insert into discussion_edits(entity_id) values(${id}::uuid)`);}
export async function createBudget(tx:DbTransaction,userId:string,kind:"topic"|"message") {
 const [c]=await rows<{cool:boolean;daily:number;live:number}>(tx,sql`select exists(select 1 from discussion_requests where user_id=${userId} and created_at>clock_timestamp()-interval '10 seconds') cool,(select count(*)::int from discussion_requests where user_id=${userId} and entity=${kind} and created_at>clock_timestamp()-interval '24 hours') daily,${kind==="topic"?sql`(select count(*)::int from discussion_topics where author_id=${userId} and state not in ('deleted','root_removed'))`:sql`(select count(*)::int from discussion_messages where author_id=${userId} and state<>'deleted')`} live`);
 if(c.cool||c.daily>=(kind==="topic"?5:50)||c.live>=(kind==="topic"?200:1000))throw limited();
}
export async function idempotent(tx:DbTransaction,userId:string,key:string,input:unknown) {const hash=communityHash(input); const [r]=await rows<{hash:string;entity:string;entity_id:string}>(tx,sql`select * from discussion_requests where user_id=${userId} and key=${key}`);if(r&&r.hash!==hash)throw conflict("DISCUSSION_IDEMPOTENCY_CONFLICT");return {hash,previous:r};}
export async function finish(ctx:StorageContext,sequence:number) { await awaitCommunityJournal(ctx,sequence); }
export { withSocialUser };

export function unavailableTopic(t:TopicRow):ForumTopic {return {id:t.id,publicId:t.public_id,boardId:t.board_id,title:null,body:null,format:"limited_markdown",author:null,revision:t.revision,controlRevision:t.control_revision,createdAt:stamp(t.created_at),editedAt:null,activityAt:stamp(t.created_at),replyCount:0,locked:true,pin:null,state:t.state==="root_removed"?"root_removed":"unavailable",subscribed:false,linkedCharts:[]};}
export function unavailableMessage(m:MessageRow):DiscussionMessage {return {id:m.id,rootId:m.root_id,replyToId:m.reply_to_id,body:null,format:"plain",author:null,createdAt:stamp(m.created_at),editedAt:null,revision:m.revision,state:"unavailable",difficulty:m.difficulty,timestampMs:null,locatable:false,publisher:false,quote:null};}
