import { sql } from "drizzle-orm";
import { StorageError } from "../storage/errors";
import type { StorageContext } from "../storage/contracts";
import { allocateForumId } from "../community/content-journal";
import type { CreateTopicInput, EditTopicInput, CreateMessageInput, ForumTopicsPage, DiscussionPage, DiscussionMessage } from "@/shared/discussions";
import { getPublicChart } from "../charts/publication";
import { rows, page, visible, topicAllowed, effectiveBoard, effectivePin, topicRow, permittedTopic, topicDto, messageDto, topicHash, messageHash, plain, missing, conflict, limited, withSocialUser, boardWritable, createBudget, idempotent, editBudget, contentFact, controlFact, finish, chartInTx, unavailableMessage, unavailableTopic, type TopicRow, type MessageRow, type Handle } from "./core";
export async function listBoards(ctx:StorageContext) {
 const bs=await rows<{id:string;name:string;description:string;order:number;read_only:boolean;revision:number}>(ctx.db,sql`select * from discussion_boards order by "order",id`);
 const items=await Promise.all(bs.map(async b=>{const [s]=await rows<{topics:number;replies:number}>(ctx.db,sql`select count(*)::int topics,coalesce(sum((select count(*) from discussion_messages m where m.topic_id=t.id and ${visible("message","m")})),0)::int replies from discussion_topics t where ${effectiveBoard()}=${b.id} and ${visible("topic","t")} and ${topicAllowed()}`); const {readCommunityFact}=await import("../community/content-journal"); const f=await readCommunityFact(ctx.db,"board_control",b.id);const {communityHash}=await import("../community/content-journal");const matched=!f?.fact.hash||f.fact.hash===communityHash({name:b.name,description:b.description,order:b.order});return {id:b.id,name:matched?b.name:b.id,description:matched?b.description:"",order:matched?b.order:(["general","creation","feedback"].indexOf(b.id)+1),readOnly:f?.fact.controls?.readOnly??b.read_only,revision:f?.fact.revision??b.revision,topicCount:s.topics,replyCount:s.replies};})); return {items};
}
export type TopicFilters = {board?:string;q?:string;sort?:"activity"|"published";unanswered?:boolean;chart?:string;cursor?:string};
export async function listTopics(ctx:StorageContext,input:TopicFilters={},viewer?:string):Promise<ForumTopicsPage> {
 const q=input.q?.trim()??""; if([...q].length>120)throw conflict();
 const chart=input.chart?await getPublicChart(ctx,input.chart):null;
 const pinMode=!q&&!input.unanswered&&(!input.sort||input.sort==="activity");
 const base=sql`${visible("topic","t")} and ${topicAllowed()} and (${input.board??null}::text is null or ${effectiveBoard()}=${input.board??null}) and (${chart?.publicId??null}::text is null or t.linked_chart_ids @> ${JSON.stringify(chart?[chart.publicId]:[])}::jsonb) and (${q}='' or strpos(lower(t.title),lower(${q}))>0 or strpos(lower(t.body),lower(${q}))>0)`;
 const pinRows=pinMode?await rows<TopicRow>(ctx.db,sql`select t.*,p.public_id::text,${effectivePin()} pin,(select revision from community_content_states c where c.key='topic_control:'||t.id::text) control_revision from discussion_topics t join forum_public_ids p on p.topic_id=t.id where ${base} and ${effectivePin()} is not null order by ${effectiveBoard()},${effectivePin()},t.id limit 9`):[];
 const p=page(input.cursor,{...input,cursor:undefined,pins:pinRows.map(t=>[t.id,t.pin,t.control_revision])});
 const activity=sql`coalesce((select max(m.created_at) from discussion_messages m where m.topic_id=t.id and ${visible("message","m")}),t.created_at)`;
 const at=input.sort==="published"?sql`t.created_at`:activity;
 const rr=await rows<TopicRow>(ctx.db,sql`select t.*,p.public_id::text,${at} activity_at from discussion_topics t join forum_public_ids p on p.topic_id=t.id where ${base} and p.journal_sequence<=(select exported_sequence from storage_journal_progress where id='global') and (${!input.unanswered} or not exists(select 1 from discussion_messages m where m.topic_id=t.id and ${visible("message","m")})) and ${pinRows.length?sql`t.id not in (${sql.join(pinRows.map(t=>sql`${t.id}::uuid`),sql`,`)})`:sql`true`} and ${p.condition(at,sql`t.id`)} order by ${at} desc,t.id desc limit 21`);
 const list=rr.slice(0,20),last=list.at(-1);
 return {items:await Promise.all(list.map(t=>topicDto(ctx,t,viewer))),pinned:await Promise.all(pinRows.map(t=>topicDto(ctx,t,viewer))),nextCursor:rr.length>20&&last?p.encode(last.activity_at??last.created_at,last.id):null};
}
async function links(ctx:StorageContext,ids:string[]) {return Promise.all(ids.map(id=>getPublicChart(ctx,id)));}
export async function createTopic(ctx:StorageContext,userId:string,input:CreateTopicInput) {
 const title=plain(input.title,100),body=plain(input.body,10000);
 const result=await withSocialUser(ctx.db,userId,async tx=>{
 const i=await idempotent(tx,userId,input.idempotencyKey,{kind:"topic",...input,title,body});
 if(i.previous) {const [old]=await rows<{public_id:string;sequence:number}>(tx,sql`select p.public_id::text,s.journal_sequence sequence from forum_public_ids p join community_content_states s on s.key='topic:'||p.topic_id::text where p.topic_id=${i.previous.entity_id}::uuid`);if(!old)throw missing();return {publicId:old.public_id,sequence:old.sequence};}
 const charts=await links(ctx,input.chartIds);await createBudget(tx,userId,"topic");await boardWritable(tx,input.boardId);for(const c of charts)await chartInTx(tx,c);
 const [r]=await rows<TopicRow>(tx,sql`insert into discussion_topics(author_id,board_id,title,body,content_hash,linked_chart_ids) values(${userId},${input.boardId},${title},${body},${topicHash({title,body,linked_chart_ids:charts.map(c=>c.publicId)})},${JSON.stringify(charts.map(c=>c.publicId))}::jsonb) returning *`);
 const allocated=await allocateForumId(tx,r.id,userId);await contentFact(tx,"topic",r);const sequence=await controlFact(tx,r);
 await tx.execute(sql`insert into discussion_requests(user_id,key,hash,entity,entity_id) values(${userId},${input.idempotencyKey},${i.hash},'topic',${r.id}::uuid)`);
 await subscription(tx,userId,r.id,true);return {publicId:allocated.publicId,sequence:Math.max(sequence,allocated.sequence)};
 });
 await finish(ctx,result.sequence);
 const saved=await topicRow(ctx.db,result.publicId);
 try {
  return await topicDto(ctx,saved,userId);
 } catch(error) {
  // Preserve an uncertain create's stable identity after withdrawal or hiding,
  // while the normal public resolver still refuses access to its old content.
  if(error instanceof StorageError&&error.status===404)return unavailableTopic(saved);
  throw error;
 }
}
export async function editTopic(ctx:StorageContext,userId:string,publicId:string,input:EditTopicInput) {
 const title=plain(input.title,100),body=plain(input.body,10000),charts=await links(ctx,input.chartIds);
 const sequence=await withSocialUser(ctx.db,userId,async tx=>{const {t,permanent}=await permittedTopic(ctx,publicId,userId,true,tx);if(t.author_id!==userId)throw missing();if(permanent||t.revision!==input.expectedRevision)throw conflict();await editBudget(tx,t.id);for(const c of charts)await chartInTx(tx,c);const [r]=await rows<TopicRow>(tx,sql`update discussion_topics set title=${title},body=${body},linked_chart_ids=${JSON.stringify(charts.map(c=>c.publicId))}::jsonb,content_hash=${topicHash({title,body,linked_chart_ids:charts.map(c=>c.publicId)})},revision=${t.revision+1},edited_at=clock_timestamp() where id=${t.id}::uuid returning *`);return contentFact(tx,"topic",r);});await finish(ctx,sequence);return topicDto(ctx,await topicRow(ctx.db,publicId),userId);
}
export async function removeTopic(ctx:StorageContext,userId:string,publicId:string,revision:number) {
 const sequence=await withSocialUser(ctx.db,userId,async tx=>{const t=await topicRow(tx,publicId,true);if(t.author_id!==userId)throw missing();const {readCommunityFact}=await import("../community/content-journal");const latest=await readCommunityFact(tx,"topic",t.id);t.revision=Math.max(t.revision,latest?.fact.revision??0);if(["deleted","root_removed"].includes(latest?.fact.state??t.state)){const {readCommunityFact}=await import("../community/content-journal");return (await readCommunityFact(tx,"topic",t.id))?.sequence??0;}if(latest?.fact.state==="hidden")return latest.sequence;if(t.revision!==revision)throw conflict();const control=await readCommunityFact(tx,"topic_control",t.id);t.control_revision=Math.max(t.control_revision,control?.fact.revision??0);const [other]=await rows(tx,sql`select 1 from discussion_messages where topic_id=${t.id}::uuid and author_id is distinct from ${userId} and state<>'deleted' limit 1`);const state=other?"root_removed":"deleted";const [r]=await rows<TopicRow>(tx,sql`update discussion_topics set title=null,body=null,content_hash='',state=${state},locked=true,pin=null,revision=${t.revision+1},control_revision=${t.control_revision+1} where id=${t.id}::uuid returning *`);const s=await contentFact(tx,"topic",r,state);const c=await controlFact(tx,r);return Math.max(s,c);});await finish(ctx,sequence);return {ok:true as const};
}
export async function subscription(tx:Handle,userId:string,topicId:string,on:boolean) {
 if(!on){await tx.execute(sql`delete from discussion_subscriptions where user_id=${userId} and topic_id=${topicId}::uuid`);return;}
 const [previous]=await rows(tx,sql`select 1 from discussion_subscriptions where user_id=${userId} and topic_id=${topicId}::uuid`);if(previous)return;
 const [count]=await rows<{n:number}>(tx,sql`select count(*)::int n from discussion_subscriptions where user_id=${userId}`);if(count.n>=200)throw limited();
 await tx.execute(sql`insert into discussion_subscriptions(user_id,topic_id) values(${userId},${topicId}::uuid) on conflict(user_id,topic_id) do nothing`);
}
export async function setSubscription(ctx:StorageContext,userId:string,publicId:string,on:boolean) {await withSocialUser(ctx.db,userId,async tx=>{const t=on?(await permittedTopic(ctx,publicId,userId,false,tx)).t:await topicRow(tx,publicId);await subscription(tx,userId,t.id,on);});return {subscribed:on};}
export async function topicReplies(ctx:StorageContext,publicId:string,cursor?:string,viewer?:string):Promise<DiscussionPage<DiscussionMessage>> {
 const {t}=await permittedTopic(ctx,publicId,viewer);const p=page(cursor,{topic:t.id},true);
 const rr=await rows<MessageRow>(ctx.db,sql`select m.* from discussion_messages m where m.topic_id=${t.id}::uuid and ${visible("message","m")} and ${p.condition(sql`m.created_at`,sql`m.id`)} order by m.created_at,m.id limit 21`);const list=rr.slice(0,20),last=list.at(-1);return {items:await Promise.all(list.map(r=>messageDto(ctx,r))),nextCursor:rr.length>20&&last?p.encode(last.created_at,last.id):null};
}
export async function getTopic(ctx:StorageContext,publicId:string,cursor?:string,viewer?:string) {const {t}=await permittedTopic(ctx,publicId,viewer);return {topic:await topicDto(ctx,t,viewer),replies:await topicReplies(ctx,publicId,cursor,viewer)};}
export async function createForumReply(ctx:StorageContext,userId:string,publicId:string,input:CreateMessageInput) {
 const body=plain(input.body,2000);
 const result=await withSocialUser(ctx.db,userId,async tx=>{const i=await idempotent(tx,userId,input.idempotencyKey,{kind:"forum_reply",publicId,...input,body});if(i.previous){const [m]=await rows<MessageRow>(tx,sql`select * from discussion_messages where id=${i.previous.entity_id}::uuid`);if(!m)throw missing();const {readCommunityFact}=await import("../community/content-journal");return {r:m,sequence:(await readCommunityFact(tx,"message",m.id))?.sequence??0};}
 const {t,available}=await permittedTopic(ctx,publicId,userId,true,tx);if(!available)throw conflict("DISCUSSION_ROOT_UNAVAILABLE");await createBudget(tx,userId,"message");const [n]=await rows<{n:number}>(tx,sql`select count(*)::int n from discussion_messages where topic_id=${t.id}::uuid`);if(n.n>=1000)throw limited();
 if(input.replyToId){const [target]=await rows(tx,sql`select m.id from discussion_messages m where m.id=${input.replyToId}::uuid and m.topic_id=${t.id}::uuid and ${visible("message","m")}`);if(!target)throw missing();}
 const value={body,difficulty:null,timestamp_ms:null,root_id:null,reply_to_id:input.replyToId??null,topic_id:t.id,chart_id:null,version_id:null};const [r]=await rows<MessageRow>(tx,sql`insert into discussion_messages(author_id,topic_id,reply_to_id,body,content_hash) values(${userId},${t.id}::uuid,${input.replyToId??null}::uuid,${body},${messageHash(value)}) returning *`);
 const sequence=await contentFact(tx,"message",r);await tx.execute(sql`insert into discussion_requests(user_id,key,hash,entity,entity_id) values(${userId},${input.idempotencyKey},${i.hash},'message',${r.id}::uuid)`);if(input.subscribe)await subscription(tx,userId,t.id,true);await tx.execute(sql`insert into discussion_outbox(actor_id,kind,topic_id,message_id,sequence) values(${userId},'message',${t.id}::uuid,${r.id}::uuid,${sequence})`);return {r,sequence};});await finish(ctx,result.sequence);try{await permittedTopic(ctx,publicId,userId);return messageDto(ctx,result.r);}catch(error){if(error instanceof Error&&"status" in error&&(error as {status:number}).status===404)return unavailableMessage(result.r);throw error;}
}
