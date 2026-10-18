import { sql } from "drizzle-orm";
import { StorageError } from "../storage/errors";
import type { StorageContext } from "../storage/contracts";
import type { ChartMessageInput, EditMessageInput, ChartDiscussion, DiscussionPage, DiscussionMessage, DiscussionFocus } from "@/shared/discussions";
import { rows, chartCurrent, chartInTx, timing, visible, page, messageHash, messageDto, plain, withSocialUser, idempotent, createBudget, contentFact, editBudget, finish, missing, conflict, permittedTopic, topicDto, unavailableMessage, type MessageRow, type TopicRow } from "./core";
import { listTopics } from "./forum";
import { readCommunityFact } from "../community/content-journal";
import type { PublicChartDto } from "@/shared/charts";
export async function chartReplies(ctx:StorageContext,id:string,rootId:string,version?:string,cursor?:string):Promise<DiscussionPage<DiscussionMessage>> {
 const chart=await chartCurrent(ctx,id,version);const [root]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${rootId}::uuid and chart_id=${chart.id}::uuid and version_id=${chart.versionId}::uuid and root_id is null`);if(!root)throw missing();
 const p=page(cursor,{chart:chart.id,version:chart.versionId,root:rootId},true);const rr=await rows<MessageRow>(ctx.db,sql`select m.* from discussion_messages m where m.root_id=${rootId}::uuid and m.chart_id=${chart.id}::uuid and m.version_id=${chart.versionId}::uuid and ${visible("message","m")} and ${p.condition(sql`m.created_at`,sql`m.id`)} order by m.created_at,m.id limit 21`);const list=rr.slice(0,20),last=list.at(-1);return {items:await Promise.all(list.map(r=>messageDto(ctx,r,chart))),nextCursor:rr.length>20&&last?p.encode(last.created_at,last.id):null};
}
export async function listChartDiscussion(ctx:StorageContext,id:string,input:{versionId?:string;difficulty?:number;cursor?:string}={}):Promise<ChartDiscussion> {
 const chart=await chartCurrent(ctx,id,input.versionId);if(input.difficulty!==undefined)timing(chart,input.difficulty,null);
 const p=page(input.cursor,{chart:chart.id,version:chart.versionId,difficulty:input.difficulty??null},true);
 // Unavailable roots remain anonymous structural placeholders only when a legal child exists.
 const rootVisible=sql`(${visible("message","m")} or exists(select 1 from discussion_messages child where child.root_id=m.id and child.chart_id=m.chart_id and child.version_id=m.version_id and ${visible("message","child")}))`;
 const rr=await rows<MessageRow>(ctx.db,sql`select m.* from discussion_messages m where m.chart_id=${chart.id}::uuid and m.version_id=${chart.versionId}::uuid and m.root_id is null and (${input.difficulty??null}::int is null or m.difficulty=${input.difficulty??null}) and ${rootVisible} and ${p.condition(sql`m.created_at`,sql`m.id`)} order by m.created_at,m.id limit 21`);const list=rr.slice(0,20),last=list.at(-1);
 const items=await Promise.all(list.map(async r=>{const dto=await messageDto(ctx,r,chart);const replies=await rows<MessageRow>(ctx.db,sql`select m.* from discussion_messages m where m.root_id=${r.id}::uuid and m.chart_id=${chart.id}::uuid and m.version_id=${chart.versionId}::uuid and ${visible("message","m")} order by m.created_at,m.id limit 4`);const [n]=await rows<{n:number}>(ctx.db,sql`select count(*)::int n from discussion_messages m where m.root_id=${r.id}::uuid and m.chart_id=${chart.id}::uuid and m.version_id=${chart.versionId}::uuid and ${visible("message","m")}`);const preview=replies.slice(0,3),tail=preview.at(-1);return {...dto,replies:await Promise.all(preview.map(m=>messageDto(ctx,m,chart))),replyCount:n.n,repliesCursor:replies.length>3&&tail?page(undefined,{chart:chart.id,version:chart.versionId,root:r.id},true).encode(tail.created_at,tail.id):null};}));
 const [n]=await rows<{n:number}>(ctx.db,sql`select count(*)::int n from discussion_messages m where m.chart_id=${chart.id}::uuid and m.version_id=${chart.versionId}::uuid and ${visible("message","m")} and (${input.difficulty??null}::int is null or coalesce((select r.difficulty from discussion_messages r where r.id=m.root_id),m.difficulty)=${input.difficulty??null})`);
 return {items,nextCursor:rr.length>20&&last?p.encode(last.created_at,last.id):null,chartId:chart.id,versionId:chart.versionId,difficulties:chart.summary.difficulties.map(d=>({difficulty:d.difficulty,durationMs:d.durationMs,previewSupported:d.previewSupported})),relatedTopics:await (async()=>{const related=await listTopics(ctx,{chart:chart.publicId});return [...related.pinned,...related.items].sort((a,b)=>b.activityAt.localeCompare(a.activityAt)||b.id.localeCompare(a.id)).slice(0,5);})(),count:n.n};
}
export async function createChartMessage(ctx:StorageContext,userId:string,id:string,input:ChartMessageInput) {
 const body=plain(input.body,2000);
 const result=await withSocialUser(ctx.db,userId,async tx=>{const i=await idempotent(tx,userId,input.idempotencyKey,{kind:"chart_message",chart:id,...input,body});if(i.previous){const [r]=await rows<MessageRow>(tx,sql`select * from discussion_messages where id=${i.previous.entity_id}::uuid`);if(!r)throw missing();return {r,sequence:(await readCommunityFact(tx,"message",r.id))?.sequence??0};}
 // Only a new request authorizes its current target. Existing account-scoped
 // requests recover before chart visibility/version checks, including after withdrawal.
 const chart=await chartCurrent(ctx,id,input.versionId);
 await createBudget(tx,userId,"message");await chartInTx(tx,chart);let difficulty=input.difficulty??null;const timestampMs=input.timestampMs??null;
 if(input.rootId){const [root]=await rows<MessageRow>(tx,sql`select * from discussion_messages where id=${input.rootId}::uuid and chart_id=${chart.id}::uuid and version_id=${chart.versionId}::uuid and root_id is null for share`);if(!root)throw missing();if(input.difficulty!==undefined&&input.difficulty!==root.difficulty)throw conflict();difficulty=root.difficulty;}
 if(input.replyToId){const [target]=await rows<MessageRow>(tx,sql`select m.* from discussion_messages m where m.id=${input.replyToId}::uuid and m.chart_id=${chart.id}::uuid and m.version_id=${chart.versionId}::uuid and coalesce(m.root_id,m.id)=${input.rootId??null}::uuid and ${visible("message","m")}`);if(!target)throw missing();}
 timing(chart,difficulty,timestampMs);const value={body,difficulty,timestamp_ms:timestampMs,root_id:input.rootId??null,reply_to_id:input.replyToId??input.rootId??null,topic_id:null,chart_id:chart.id,version_id:chart.versionId};
 const [r]=await rows<MessageRow>(tx,sql`insert into discussion_messages(author_id,chart_id,version_id,root_id,reply_to_id,body,content_hash,difficulty,timestamp_ms) values(${userId},${chart.id}::uuid,${chart.versionId}::uuid,${value.root_id}::uuid,${value.reply_to_id}::uuid,${body},${messageHash(value)},${difficulty},${timestampMs}) returning *`);
 const sequence=await contentFact(tx,"message",r);await tx.execute(sql`insert into discussion_requests(user_id,key,hash,entity,entity_id) values(${userId},${input.idempotencyKey},${i.hash},'message',${r.id}::uuid)`);await tx.execute(sql`insert into discussion_outbox(actor_id,kind,message_id,recipient_id,sequence) values(${userId},'message',${r.id}::uuid,${!r.root_id?chart.author?.id??null:null},${sequence})`);return {r,sequence};});
 await finish(ctx,result.sequence);
 // A replay returns the original stable identity without exposing content from an
 // unavailable chart or a superseded file version. The same check covers withdrawal
 // racing the successful commit of a new comment.
 let chart:PublicChartDto;
 try {
  chart=await chartCurrent(ctx,id,result.r.version_id??input.versionId);
 } catch(error) {
  if(error instanceof StorageError&&(error.status===404||error.status===409))return unavailableMessage(result.r);
  throw error;
 }
 if(result.r.chart_id!==chart.id)return unavailableMessage(result.r);
 return messageDto(ctx,result.r,chart);
}
export async function messageContext(ctx:StorageContext,r:MessageRow,viewer?:string) {
 if(r.topic_id){const [t]=await rows<TopicRow>(ctx.db,sql`select t.*,p.public_id::text from discussion_topics t join forum_public_ids p on p.topic_id=t.id where t.id=${r.topic_id}::uuid`);if(!t)throw missing();return {topic:await permittedTopic(ctx,t.public_id,viewer),chart:undefined};}
 if(!r.chart_id||!r.version_id)throw missing();return {chart:await chartCurrent(ctx,r.chart_id,r.version_id),topic:undefined};
}
export async function editMessage(ctx:StorageContext,userId:string,id:string,input:EditMessageInput) {
 const body=plain(input.body,2000);const [initial]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${id}::uuid`);if(!initial)throw missing();const context=await messageContext(ctx,initial,userId);
 const result=await withSocialUser(ctx.db,userId,async tx=>{const [r]=await rows<MessageRow>(tx,sql`select * from discussion_messages where id=${id}::uuid for update`);if(!r||r.author_id!==userId||r.state!=="visible")throw missing();const latest=await readCommunityFact(tx,"message",id);if(latest&&["hidden","deleted"].includes(latest.fact.state))throw missing();r.revision=Math.max(r.revision,latest?.fact.revision??0);if(r.revision!==input.expectedRevision)throw conflict();if(context.topic)await permittedTopic(ctx,context.topic.t.public_id,userId,true,tx);if(context.chart)await chartInTx(tx,context.chart);await editBudget(tx,id);
 let difficulty=input.difficulty===undefined?r.difficulty:input.difficulty;const timestampMs=input.timestampMs===undefined?r.timestamp_ms:input.timestampMs;
 if(r.topic_id&&(input.difficulty!==undefined||input.timestampMs!==undefined))throw conflict();
 if(r.root_id){const [root]=await rows<MessageRow>(tx,sql`select * from discussion_messages where id=${r.root_id}::uuid for share`);if(!root||(input.difficulty!==undefined&&input.difficulty!==null&&input.difficulty!==root.difficulty))throw conflict();difficulty=root.difficulty;}
 if(context.chart) {timing(context.chart,difficulty,timestampMs);if(!r.root_id&&r.difficulty!==null&&difficulty!==r.difficulty){const [children]=await rows(tx,sql`select 1 from discussion_messages where root_id=${r.id}::uuid limit 1`);if(children)throw conflict("DISCUSSION_CHANGED");}}
 const value={...r,body,difficulty,timestamp_ms:timestampMs};const [saved]=await rows<MessageRow>(tx,sql`update discussion_messages set body=${body},difficulty=${difficulty},timestamp_ms=${timestampMs},content_hash=${messageHash(value)},revision=${r.revision+1},edited_at=clock_timestamp() where id=${id}::uuid returning *`);return {r:saved,sequence:await contentFact(tx,"message",saved)};});await finish(ctx,result.sequence);return messageDto(ctx,result.r,context.chart);
}
export async function removeMessage(ctx:StorageContext,userId:string,id:string,revision:number) {
 const sequence=await withSocialUser(ctx.db,userId,async tx=>{const [r]=await rows<MessageRow>(tx,sql`select * from discussion_messages where id=${id}::uuid for update`);if(!r||r.author_id!==userId)throw missing();const latest=await readCommunityFact(tx,"message",id);r.revision=Math.max(r.revision,latest?.fact.revision??0);if(latest?.fact.state==="hidden")throw missing();if(latest?.fact.state==="deleted"||r.state==="deleted")return (await readCommunityFact(tx,"message",id))?.sequence??0;if(r.revision!==revision)throw conflict();const [saved]=await rows<MessageRow>(tx,sql`update discussion_messages set body=null,state='deleted',content_hash='',timestamp_ms=null,revision=${r.revision+1} where id=${id}::uuid returning *`);return contentFact(tx,"message",saved,"deleted");});await finish(ctx,sequence);return {ok:true as const};
}
export async function focusMessage(ctx:StorageContext,container:{topic?:string;chart?:string;version?:string},id:string,viewer?:string):Promise<DiscussionFocus> {
 const [r]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${id}::uuid`);if(!r)throw missing();const context=await messageContext(ctx,r,viewer);
 if(container.topic&&context.topic?.t.public_id!==container.topic)throw missing();if(container.chart){const c=await chartCurrent(ctx,container.chart,container.version);if(c.id!==r.chart_id||c.versionId!==r.version_id)throw missing();}
 const dto=await messageDto(ctx,r,context.chart);if(dto.state!=="visible")throw missing();const rootId=r.root_id??r.id;
 const around=await rows<MessageRow>(ctx.db,sql`select m.* from discussion_messages m where ${r.topic_id?sql`m.topic_id=${r.topic_id}::uuid`:sql`m.chart_id=${r.chart_id}::uuid and m.version_id=${r.version_id}::uuid and coalesce(m.root_id,m.id)=${rootId}::uuid`} and ${visible("message","m")} and (m.created_at,m.id)>=(${r.created_at}::timestamptz,${r.id}::uuid) order by m.created_at,m.id limit 20`);
 let root:DiscussionMessage|undefined; if(context.chart){const [rr]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${rootId}::uuid`);root=await messageDto(ctx,rr,context.chart);}
 return {focusId:id,messages:await Promise.all(around.map(m=>messageDto(ctx,m,context.chart))),...(root?{root}:{}),...(context.topic?{topic:await topicDto(ctx,context.topic.t,viewer)}:{})};
}
