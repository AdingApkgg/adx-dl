import { sql, type SQL } from "drizzle-orm";
import { appealInputSchema, appealResolutionSchema, APPEAL_LIMIT, type AppealInput, type AppealResolution, type GovernanceAppeal, type GovernanceDecision, type GovernancePage, type GovernanceQuery } from "@/shared/governance";
import type { StorageContext } from "../storage/contracts";
import { rows, exported, type Handle } from "../discussions/core";
import { withSocialUser, requireActiveSocialUser } from "../services/social-page";
import { StorageError } from "../storage/errors";
import { governancePage, governanceStamp } from "./page";
const missing=()=>new StorageError(404,"NOT_FOUND");
const changed=()=>new StorageError(409,"GOVERNANCE_CHANGED");
// A decision is not an alternate visibility authority. Verify the related control is durable.
function decisions(userId:string|SQL){return sql`(select d.id,'decision:'||d.id::text key,d.entity,d.entity_id target_id,d.action,d.public_reason,d.created_at
 from discussion_decisions d where d.recipient_id=${userId} and d.action in ('hide','lock') and (
 (d.entity in ('topic','message') and exists(select 1 from community_content_states c where c.key=(case when d.entity='topic' and d.action='lock' then 'topic_control' else d.entity end)||':'||d.entity_id and c.journal_sequence<=${exported} and adxc_community_fact_valid(c.fact)))
 or (d.entity='list' and exists(select 1 from chart_list_controls c where c.id::text=d.entity_id and c.journal_sequence<=${exported}) and exists(select 1 from chart_library_status where id='global' and ready)))
 union all select m.chart_id,'chart:'||m.chart_id::text,'chart',m.chart_id::text,'hide',m.reason,m.created_at
 from chart_moderations m join charts c on c.id=m.chart_id where c.owner_id=${userId} and m.journal_sequence>0 and m.journal_sequence<=${exported})`;}
export async function governanceRead<T>(ctx:StorageContext,query:SQL):Promise<T[]>{return ctx.db.transaction(async tx=>{await tx.execute(sql`set local statement_timeout='2s'`);await tx.execute(sql`set local lock_timeout='1s'`);return rows<T>(tx,query);});}
async function decision(db:Handle,userId:string,key:string){const [d]=await rows<{public_reason:string}>(db,sql`select public_reason from ${decisions(userId)} d where key=${key}`);return d;}
export async function governanceDecisions(ctx:StorageContext,userId:string,input:GovernanceQuery):Promise<GovernancePage<GovernanceDecision>>{
 await requireActiveSocialUser(ctx.db,userId);const p=governancePage(input,`decisions:${userId}`);
 const rr=await governanceRead<GovernanceDecision&{id:string}>(ctx,sql`select d.id,d.key,d.entity,d.target_id "targetId",d.action,d.public_reason "publicReason",${governanceStamp(sql`d.created_at`)} "createdAt",a.id "appealId"
 from ${decisions(userId)} d left join governance_appeals a on a.user_id=${userId} and a.decision_key=d.key
 where ${p.condition(sql`d.created_at`,sql`d.id`,sql`d.entity`)} order by d.created_at desc,d.id desc,d.entity desc limit 21`);
 const selected=rr.slice(0,20),last=selected.at(-1);return {items:selected.map(({id:_,...d})=>d),nextCursor:rr.length>20&&last?p.encode(last.createdAt,last.id,last.entity):null};
}
type AppealRow={id:string;user_id:string;decision_key:string;reason:string;status:GovernanceAppeal['status'];revision:number;created_at:Date;resolved_at:Date|null;resolution_note:string|null};
const dto=(r:AppealRow,reason:string|null):GovernanceAppeal=>({id:r.id,decisionKey:r.decision_key,reason:r.reason,status:r.status,revision:r.revision,createdAt:r.created_at.toISOString(),resolvedAt:r.resolved_at?.toISOString()??null,resolutionNote:r.resolution_note,publicReason:reason});
export async function listAppeals(ctx:StorageContext,input:GovernanceQuery,userId?:string):Promise<GovernancePage<GovernanceAppeal>>{
 if(userId)await requireActiveSocialUser(ctx.db,userId);const status=input.status??"all",p=governancePage(input,`appeals:${userId??'dash'}:${status}`);
 const rr=await governanceRead<GovernanceAppeal&{cursorAt:string}>(ctx,sql`select a.id,a.decision_key "decisionKey",a.reason,a.status,a.revision,${governanceStamp(sql`a.created_at`)} "createdAt",${governanceStamp(sql`a.created_at`)} "cursorAt",${governanceStamp(sql`a.resolved_at`)} "resolvedAt",a.resolution_note "resolutionNote",d.public_reason "publicReason"
 from governance_appeals a left join lateral (select public_reason from ${decisions(sql`a.user_id`)} decision where decision.key=a.decision_key) d on true
 where (${!userId} or a.user_id=${userId??''}) and (${status}='all' or (${status}='open' and a.status='open') or (${status}='resolved' and a.status<>'open'))
 and ${p.condition(sql`a.created_at`,sql`a.id`,sql`'appeal'::text`)} order by a.created_at desc,a.id desc limit 21`);
 const selected=rr.slice(0,20),last=selected.at(-1);return {items:selected.map(({cursorAt:_,...r})=>r),nextCursor:rr.length>20&&last?p.encode(last.cursorAt,last.id,"appeal"):null};
}
export async function createAppeal(ctx:StorageContext,userId:string,value:AppealInput):Promise<GovernanceAppeal>{
 const input=appealInputSchema.parse(value);return withSocialUser(ctx.db,userId,async tx=>{
  const [existing]=await rows<AppealRow>(tx,sql`select * from governance_appeals where user_id=${userId} and decision_key=${input.decisionKey}`);
  if(existing)return dto(existing,(await decision(tx,userId,input.decisionKey))?.public_reason??null);
  const d=await decision(tx,userId,input.decisionKey);if(!d)throw missing();
  const [n]=await rows<{open:number;daily:number}>(tx,sql`select count(*) filter(where status='open')::int open,count(*) filter(where created_at>clock_timestamp()-interval '24 hours')::int daily from governance_appeals where user_id=${userId}`);
  if(n.open>=APPEAL_LIMIT||n.daily>=APPEAL_LIMIT)throw new StorageError(429,"GOVERNANCE_LIMIT","GOVERNANCE_LIMIT",3600);
  const [saved]=await rows<AppealRow>(tx,sql`insert into governance_appeals(user_id,decision_key,reason) values(${userId},${input.decisionKey},${input.reason}) returning *`);return dto(saved,d.public_reason);
 });
}
export async function resolveAppeal(ctx:StorageContext,actorId:string,id:string,value:AppealResolution):Promise<GovernanceAppeal>{
 const input=appealResolutionSchema.parse(value);return withSocialUser(ctx.db,actorId,async tx=>{
  const [candidate]=await rows<{user_id:string}>(tx,sql`select user_id from governance_appeals where id=${id}::uuid`);if(!candidate)throw missing();
  const [recipient]=await rows(tx,sql`select id from "user" where id=${candidate.user_id} for key share`);if(!recipient)throw missing();
  const [r]=await rows<AppealRow>(tx,sql`select * from governance_appeals where id=${id}::uuid for update`);if(!r)throw missing();
  const publicReason=(await decision(tx,r.user_id,r.decision_key))?.public_reason??null;
  if(r.status!=="open"){
   if(r.revision===input.expectedRevision+1&&r.status===input.status&&r.resolution_note===input.note)return dto(r,publicReason);
   throw changed();
  }
  if(r.revision!==input.expectedRevision)throw changed();
  const [saved]=await rows<AppealRow>(tx,sql`update governance_appeals set status=${input.status},resolution_note=${input.note},resolved_at=clock_timestamp(),revision=revision+1 where id=${id}::uuid returning *`);
  const decisionId=crypto.randomUUID();
  await tx.execute(sql`insert into discussion_decisions(id,actor_id,recipient_id,entity,entity_id,action,reason,public_reason) values(${decisionId}::uuid,${actorId},${r.user_id},'appeal',${id},${input.status},'','')`);
  await tx.execute(sql`insert into discussion_outbox(actor_id,kind,recipient_id,decision_id,sequence) values(${actorId},'moderation',${r.user_id},${decisionId}::uuid,0)`);
  return dto(saved,publicReason);
 });
}
