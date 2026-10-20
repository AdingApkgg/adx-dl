import {sweepLibraryOrphans} from "../library/deletion";
import { assertFollowingReady } from "../following/core";
import { authorUpdateDto, readUpdateNotifications } from "../following/notifications";
import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { StorageContext } from "../storage/contracts";
import type { DiscussionNotification, MyDiscussion } from "@/shared/discussions";
import { rows, page, exported, missing, withSocialUser, topicRow, topicDto, messageDto, stamp, factMatches, author, unavailableTopic, type MessageRow, type TopicRow } from "./core";
import { messageContext } from "./messages";
import { withStorageTransaction } from "../storage/transactions";
import { StorageError } from "../storage/errors";
export const DISCUSSION_DISPATCH_QUEUE="discussion.dispatch";
type EventRow={id:string;actor_id:string|null;kind:"message"|"moderation"|"report_resolution"|"chart_report_resolution";topic_id:string|null;message_id:string|null;recipient_id:string|null;decision_id:string|null;report_id:string|null;sequence:number;cursor:string|null;completed:boolean;created_at:Date};
type NotificationRow={id:string;user_id:string;kind:DiscussionNotification["kind"]|"chart_report_resolution";event_id:string;topic_id:string|null;message_id:string|null;decision_id:string|null;report_id:string|null;event_at:Date;read_at:Date|null;created_at:Date};
function unavailable(error:unknown) {if(error instanceof StorageError&&[404,409].includes(error.status))return true;return false;}
async function eventMessage(ctx:StorageContext,e:EventRow) {if(!e.message_id)return null;const [m]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${e.message_id}::uuid`);if(!m||!await factMatches(ctx.db,"message",m)||!await author(ctx.db,m.author_id))return null;try{const c=await messageContext(ctx,m);if(c.topic){const dto=await topicDto(ctx,c.topic.t);if(dto.state!=="visible")return null;}return {m,c};}catch(error){if(unavailable(error))return null;throw error;}}
/** Scheduled bounded outbox delivery. At most 20 events x 100 recipients each invocation. */
export async function dispatchDiscussionOutbox(ctx:StorageContext) {
 await sweepLibraryOrphans(ctx);
 const events=await rows<EventRow>(ctx.db,sql`select * from discussion_outbox where not completed and sequence<=${exported} order by created_at,id limit 20`);
 for(const e of events){let message:Awaited<ReturnType<typeof eventMessage>>=null;if(e.kind==="message"){message=await eventMessage(ctx,e);if(!message){await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update discussion_outbox set completed=true where id=${e.id}::uuid`));continue;}}
 let direct:string|null=e.recipient_id;
 if(message?.m.reply_to_id){const [target]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${message.m.reply_to_id}::uuid`);if(target&&await factMatches(ctx.db,"message",target))direct=target.author_id;}
 const recipients=await rows<{id:string;direct:boolean}>(ctx.db,sql`select u.id,(u.id=${direct}) direct from "user" u where u.status='active' and (u.id is distinct from ${e.actor_id} or (${e.kind}='moderation' and exists(select 1 from discussion_decisions where id=${e.decision_id}::uuid and entity='appeal'))) and (${e.cursor}::text is null or u.id>${e.cursor}) and (u.id=${direct} or (${e.kind}='message' and ${e.topic_id}::uuid is not null and exists(select 1 from discussion_subscriptions s where s.topic_id=${e.topic_id}::uuid and s.user_id=u.id))) order by u.id limit 101`);
 const batch=recipients.slice(0,100);
 for(const r of batch){await withSocialUser(ctx.db,r.id,async tx=>{
 // Recheck cancellation, publication, and account visibility immediately before delivery.
 const activeMessage=e.kind==="message"?await eventMessage(ctx,e):null;if(e.kind==="message"&&!activeMessage)return;
 if(!r.direct){const [sub]=await rows(tx,sql`select 1 from discussion_subscriptions where user_id=${r.id} and topic_id=${e.topic_id}::uuid`);if(!sub)return;}
 const [inserted]=await rows(tx,sql`insert into discussion_deliveries(event_id,user_id) values(${e.id}::uuid,${r.id}) on conflict(event_id,user_id) do nothing returning id`);if(!inserted)return;
 const kind:NotificationRow["kind"]=e.kind==="moderation"?"moderation":e.kind==="report_resolution"?"report_resolution":e.kind==="chart_report_resolution"?"chart_report_resolution":r.direct?(activeMessage?.m.root_id||activeMessage?.m.topic_id?"direct_reply":"chart_comment"):"subscription";
 if(kind==="subscription"){
 // A delayed older event must not resurrect an already-read group or replace a newer anchor.
 const [newer]=await rows(tx,sql`select 1 from discussion_notifications where user_id=${r.id} and kind='subscription' and topic_id=${e.topic_id}::uuid and (event_at,event_id)>=(${e.created_at}::timestamptz,${e.id}::uuid) limit 1`);if(newer)return;
 const [group]=await rows<NotificationRow>(tx,sql`select * from discussion_notifications where user_id=${r.id} and topic_id=${e.topic_id}::uuid and kind='subscription' and read_at is null for update`);
 if(group)await tx.execute(sql`update discussion_notifications set event_id=${e.id}::uuid,event_at=${e.created_at},message_id=${e.message_id}::uuid where id=${group.id}::uuid and (event_at,event_id)<(${e.created_at}::timestamptz,${e.id}::uuid)`);
 else await tx.execute(sql`insert into discussion_notifications(user_id,kind,event_id,topic_id,message_id,event_at) values(${r.id},${kind},${e.id}::uuid,${e.topic_id}::uuid,${e.message_id}::uuid,${e.created_at})`);
 }else await tx.execute(sql`insert into discussion_notifications(user_id,kind,event_id,topic_id,message_id,decision_id,report_id,event_at) values(${r.id},${kind},${e.id}::uuid,${e.topic_id}::uuid,${e.message_id}::uuid,${e.decision_id}::uuid,${e.report_id}::uuid,${e.created_at})`);
 await tx.execute(sql`delete from discussion_notifications where user_id=${r.id} and id in(select id from discussion_notifications where user_id=${r.id} order by event_at desc,id desc offset 1000)`);
 }).catch(error=>{if(error instanceof Error&&"status" in error&&(error as {status:number}).status===403)return;throw error;});}
 await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update discussion_outbox set cursor=${batch.at(-1)?.id??e.cursor},completed=${recipients.length<=100} where id=${e.id}::uuid and cursor is not distinct from ${e.cursor}`));
 }
 // Read-side expiry is authoritative; this bounded physical cleanup contains no evidence fallback.
 await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update discussion_reports set evidence_title=null,evidence_body=null where id in(select id from discussion_reports where evidence_body is not null and evidence_expires_at<=clock_timestamp() limit 200)`));
}
export async function registerDiscussionWorker(ctx:StorageContext,boss:PgBoss) {await boss.work(DISCUSSION_DISPATCH_QUEUE,async()=>{await dispatchDiscussionOutbox(ctx);});await boss.schedule(DISCUSSION_DISPATCH_QUEUE,"* * * * *",{});}
export async function notificationDto(ctx:StorageContext,n:NotificationRow):Promise<DiscussionNotification> {
 if(n.kind==="author_update") {
  const update=await authorUpdateDto(ctx,n.user_id,n.id);
  return {id:n.id,kind:"author_update",createdAt:stamp(n.created_at),eventAt:stamp(n.event_at),read:!!n.read_at,available:update.state!=="unavailable",href:update.chart?`/charts/${update.chart.publicId}`:null,topic:null,message:null,publicReason:null,update};
 }
 let topic:DiscussionNotification["topic"]=null,message:DiscussionNotification["message"]=null,href:string|null=null,publicReason:string|null=null;
 if(n.message_id){const [m]=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages where id=${n.message_id}::uuid`);if(m){try{const c=await messageContext(ctx,m,n.user_id);message=await messageDto(ctx,m,c.chart);if(message.state==="visible"){if(c.topic){topic=await topicDto(ctx,c.topic.t,n.user_id);if(topic.state==="visible")href=`/forum/${topic.publicId}#message-${message.id}`;}else if(c.chart)href=`/charts/${c.chart.publicId}#message-${message.id}`;}if(!href)message=null;}catch(error){if(!unavailable(error))throw error;}}}
 if(n.decision_id){const [d]=await rows<{public_reason:string;entity:string}>(ctx.db,sql`select public_reason,entity from discussion_decisions where id=${n.decision_id}::uuid and recipient_id=${n.user_id}`);if(d){publicReason=d.public_reason;if(d.entity==="appeal")href="/me/governance";}}
 if(n.report_id&&n.kind==="chart_report_resolution"){const [r]=await rows<{resolution_note:string}>(ctx.db,sql`select resolution_note from chart_reports where id=${n.report_id}::uuid and reporter_id=${n.user_id}`);if(r){publicReason=r.resolution_note;href="/me/reports";}}
 if(n.report_id&&n.kind!=="chart_report_resolution"){const [r]=await rows<{resolution_note:string}>(ctx.db,sql`select resolution_note from discussion_reports where id=${n.report_id}::uuid and reporter_id=${n.user_id}`);if(r){publicReason=r.resolution_note;href="/me/discussions?kind=reports";}else{const [lr]=await rows<{resolution_note:string}>(ctx.db,sql`select resolution_note from chart_list_reports where id=${n.report_id}::uuid and reporter_id=${n.user_id}`);if(lr){publicReason=lr.resolution_note;href="/me/library?view=reports";}}}
 return {id:n.id,kind:n.kind==="chart_report_resolution"?"report_resolution":n.kind,createdAt:stamp(n.created_at),eventAt:stamp(n.event_at),read:!!n.read_at,available:!!href||!!publicReason,href,topic,message,publicReason};
}
export async function listNotifications(ctx:StorageContext,userId:string,input:{cursor?:string;unread?:boolean;kind?:"author_update"}) {
 let followingAvailable=true;try{await assertFollowingReady(ctx.db,userId);}catch{followingAvailable=false;}
 const p=page(input.cursor,{notifications:userId,unread:!!input.unread,kind:input.kind??"all"});
 const union=sql`(select id,user_id,kind,event_id,topic_id,message_id,decision_id,report_id,event_at,read_at,created_at from discussion_notifications where user_id=${userId}
  union all select id,user_id,'author_update'::text,event_id,null::uuid,null::uuid,null::uuid,null::uuid,event_at,read_at,created_at from community_update_notifications
  where user_id=${userId} and ${followingAvailable} and journal_sequence<=${exported})`;
 const rr=await rows<NotificationRow>(ctx.db,sql`select * from ${union} n where (${!input.unread} or n.read_at is null) and (${input.kind===undefined} or n.kind='author_update')
  and ${p.condition(sql`n.event_at`,sql`n.id`)} order by n.event_at desc,n.id desc limit 21`);
 const list=rr.slice(0,20),last=list.at(-1);
 const [n]=await rows<{n:number}>(ctx.db,sql`select count(*)::int n from ${union} n where read_at is null`);
 return {items:await Promise.all(list.map(r=>notificationDto(ctx,r))),unreadCount:n.n,nextCursor:rr.length>20&&last?p.encode(last.event_at,last.id):null,followingUnavailable:!followingAvailable};
}
export async function readNotifications(ctx:StorageContext,userId:string,ids:string[]) {
 await readUpdateNotifications(ctx,userId,ids);
 await withSocialUser(ctx.db,userId,tx=>tx.execute(sql`update discussion_notifications set read_at=clock_timestamp() where user_id=${userId} and id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) and read_at is null`));
 return {ok:true as const};
}
export async function myDiscussions(ctx:StorageContext,userId:string,input:{kind?:string;cursor?:string}) {
 const kind=input.kind??"topics",p=page(input.cursor,{my:userId,kind});let result:{id:string;at:Date;topic:TopicRow|null;message:MessageRow|null}[]=[];
 if(kind==="topics"||kind==="subscriptions"){const rr=await rows<TopicRow & {at:Date}>(ctx.db,sql`select t.*,p.public_id::text,${kind==="subscriptions"?sql`s.created_at`:sql`t.created_at`} at from discussion_topics t join forum_public_ids p on p.topic_id=t.id ${kind==="subscriptions"?sql`join discussion_subscriptions s on s.topic_id=t.id and s.user_id=${userId}`:sql``} where ${kind==="topics"?sql`t.author_id=${userId}`:sql`true`} and ${p.condition(kind==="subscriptions"?sql`s.created_at`:sql`t.created_at`,sql`t.id`)} order by ${kind==="subscriptions"?sql`s.created_at`:sql`t.created_at`} desc,t.id desc limit 21`);result=rr.map(t=>({id:t.id,at:t.at,topic:t,message:null}));}
 else {const rr=await rows<MessageRow>(ctx.db,sql`select * from discussion_messages m where m.author_id=${userId} and ${p.condition(sql`m.created_at`,sql`m.id`)} order by m.created_at desc,m.id desc limit 21`);result=rr.map(m=>({id:m.id,at:m.created_at,topic:null,message:m}));}
 const list=result.slice(0,20),last=list.at(-1);const items:MyDiscussion[]=await Promise.all(list.map(async r=>{const base:MyDiscussion={id:r.id,kind:r.topic?"forum_topic":r.message?.topic_id?"forum_reply":"chart_comment",createdAt:stamp(r.at),state:r.topic?.state??r.message?.state??"unavailable",topic:null,message:null,href:null};try{if(r.topic){const dto=await topicDto(ctx,r.topic,userId);base.topic=dto;base.state=dto.state;base.href=dto.state==="visible"||dto.replyCount>0?`/forum/${dto.publicId}`:null;}else if(r.message){const c=await messageContext(ctx,r.message,userId);const dto=await messageDto(ctx,r.message,c.chart);if(dto.state==="visible"){base.message=dto;base.href=c.topic?`/forum/${c.topic.t.public_id}#message-${dto.id}`:`/charts/${c.chart!.publicId}#message-${dto.id}`;}else base.state="unavailable";}}catch(error){if(!unavailable(error))throw error;base.state="unavailable";if(r.topic){base.topic={...unavailableTopic(r.topic),subscribed:kind==="subscriptions"};}}return base;}));return {items,nextCursor:result.length>20&&last?p.encode(last.at,last.id):null};
}
