import { StorageUnavailableError } from "../storage/errors";
import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { StorageContext } from "../storage/contracts";
import type { Db } from "../db/client";
import type { AuthorUpdateNotice, FollowingStatus } from "@/shared/following";
import type { PrivateNotificationFact } from "@/shared/private-social-journal";
import { withStorageTransaction } from "../storage/transactions";
import { withSocialUser } from "../services/social-page";
import { getPublicChartsByIds } from "../charts/publication";
import { runStorageWork } from "../storage/runtime";
import { storageTime } from "../storage/usage";
import { assertFollowingReady, effectiveFollow, exported, rows, stamp, withFollowingPair, type EventRow, type UpdateRow } from "./core";
import { awaitPrivateJournal, recordPrivateFact } from "./journal";
export const FOLLOWING_DISPATCH_QUEUE="following.dispatch";
function notificationFact(row:UpdateRow):PrivateNotificationFact {
 return {version:1,entity:"notification",id:row.id,revision:row.revision,userId:row.user_id,authorId:row.author_id,eventId:row.event_id,eventAt:stamp(row.event_at),createdAt:stamp(row.created_at),readAt:row.read_at?stamp(row.read_at):null};
}
async function currentEvent(ctx:StorageContext,event:EventRow) {
 if(!event.author_id)return null;
 // Caller holds a transaction: serialize visibility classification with permission writes.
 const [visibility]=await rows<{pending:boolean}>(ctx.db,sql`select publication_sequence>${exported} pending from charts where id=${event.chart_id}::uuid for share`);
 if(visibility?.pending)throw new StorageUnavailableError();
 const [chart]=await getPublicChartsByIds(ctx,[event.chart_id]);
 return chart&&chart.author?.id===event.author_id&&chart.versionId===event.version_id?chart:null;
}
/** Safe to retry after any crash: per-recipient fact is authoritative, cursor is only an optimization. */
export async function dispatchFollowingUpdates(ctx:StorageContext) {
 await assertFollowingReady(ctx.db);
 try {
  const events=await rows<EventRow>(ctx.db,sql`select * from community_publication_events where not completed and journal_sequence<=${exported} order by occurred_at,id limit 20`);
  for(const event of events) {
   if(!event.notify||!event.author_id||!await withStorageTransaction(ctx.db,tx=>currentEvent({...ctx,db:tx as unknown as Db},event))) {await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update community_publication_events set completed=true where id=${event.id}::uuid`));continue;}
   const recipients=await rows<{id:string}>(ctx.db,sql`select f.user_id id from community_follows f join "user" u on u.id=f.user_id and u.status='active'
    where f.author_id=${event.author_id} and ${effectiveFollow()} and f.notify_since<=${event.occurred_at} and f.followed_at<=${event.occurred_at}
    and f.journal_sequence<=${exported} and f.journal_sequence<${event.journal_sequence} and (${event.cursor}::text is null or f.user_id>${event.cursor}) order by f.user_id limit 101`);
   let lastSequence=0;
   for(const recipient of recipients.slice(0,100)) {
    try {
     const sequence=await withFollowingPair(ctx,recipient.id,event.author_id,true,async tx=>{
      const [follow]=await rows(tx,sql`select 1 from community_follows f where f.user_id=${recipient.id} and f.author_id=${event.author_id}
       and ${effectiveFollow()} and f.notify_since<=${event.occurred_at} and f.followed_at<=${event.occurred_at} and f.journal_sequence<=${exported} and f.journal_sequence<${event.journal_sequence}`);
      if(!follow)return 0;
      await tx.execute(sql`select id from charts where id=${event.chart_id}::uuid for share`);
      if(!await currentEvent({...ctx,db:tx as unknown as Db},event))return 0;
      const [delivered]=await rows<{journal_sequence:number}>(tx,sql`select journal_sequence from community_update_deliveries where event_id=${event.id}::uuid and user_id=${recipient.id}`);
      if(delivered)return Number(delivered.journal_sequence);
      // Never replace a newer anchor or resurrect a group already read before an older delivery arrived.
      const [newer]=await rows<{journal_sequence:number}>(tx,sql`select journal_sequence from community_update_notifications where user_id=${recipient.id} and author_id=${event.author_id}
       and (event_at,event_id)>=(${event.occurred_at}::timestamptz,${event.id}::uuid) order by event_at desc,event_id desc limit 1`);
      if(newer)return Number(newer.journal_sequence);
      const [group]=await rows<UpdateRow>(tx,sql`select * from community_update_notifications where user_id=${recipient.id} and author_id=${event.author_id} and read_at is null for update`);
      const now=await storageTime(tx);
      const next:UpdateRow=group?{...group,event_id:event.id,event_at:event.occurred_at,revision:group.revision+1}:
       {id:crypto.randomUUID(),user_id:recipient.id,author_id:event.author_id,event_id:event.id,event_at:event.occurred_at,created_at:now,read_at:null,revision:1,journal_sequence:0};
      const sequence=await recordPrivateFact(tx,notificationFact(next));
      await tx.execute(sql`insert into community_update_deliveries(event_id,user_id,journal_sequence) values(${event.id}::uuid,${recipient.id},${sequence}) on conflict do nothing`);
      await tx.execute(sql`insert into community_update_notifications(id,user_id,author_id,event_id,event_at,created_at,read_at,revision,journal_sequence)
       values(${next.id}::uuid,${next.user_id},${next.author_id},${next.event_id}::uuid,${next.event_at},${next.created_at},null,${next.revision},${sequence})
       on conflict(id) do update set event_id=excluded.event_id,event_at=excluded.event_at,revision=excluded.revision,journal_sequence=excluded.journal_sequence`);
      return sequence;
     });
     lastSequence=Math.max(lastSequence,sequence);
    } catch(error) {
     // A concurrent cancellation/deletion is a skipped recipient; infrastructure errors retry the event.
     const status=error&&typeof error==="object"&&"status" in error?(error as {status:number}).status:0;
     if(![403,404].includes(status))throw error;
    }
   }
   if(lastSequence)await awaitPrivateJournal(ctx,lastSequence);
   await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update community_publication_events set cursor=${recipients.slice(0,100).at(-1)?.id??event.cursor},completed=${recipients.length<=100}
    where id=${event.id}::uuid and cursor is not distinct from ${event.cursor}`));
  }
  await cleanupFollowingOrphans(ctx);
  await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update community_following_status set last_success_at=clock_timestamp() where id='global'`));
 } catch(error) {
  await withStorageTransaction(ctx.db,tx=>tx.execute(sql`update community_following_status set failures=least(failures::bigint+1,2147483647)::int,last_failure_at=clock_timestamp() where id='global'`)).catch(()=>{});
  throw error;
 }
}
export async function readUpdateNotifications(ctx:StorageContext,userId:string,ids:string[]) {
 const sequence=await withSocialUser(ctx.db,userId,async tx=>{
  const records=await rows<UpdateRow>(tx,sql`select * from community_update_notifications where user_id=${userId} and id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) order by id for update`);
  if(!records.length)return 0;
  await assertFollowingReady(tx);
  let last=0;
  for(const row of records) {
   if(row.read_at){last=Math.max(last,row.journal_sequence);continue;}
   const now=await storageTime(tx),next={...row,revision:row.revision+1,read_at:now};
   const sequence=await recordPrivateFact(tx,notificationFact(next));
   await tx.execute(sql`update community_update_notifications set read_at=${now},revision=${next.revision},journal_sequence=${sequence} where id=${row.id}::uuid`);
   last=Math.max(last,sequence);
  }
  return last;
 });
 await awaitPrivateJournal(ctx,sequence);
}
export async function authorUpdateDto(ctx:StorageContext,userId:string,id:string):Promise<AuthorUpdateNotice> {
 const [row]=await rows<UpdateRow&{chart_id:string;version_id:string}>(ctx.db,sql`select n.*,e.chart_id,e.version_id from community_update_notifications n join community_publication_events e on e.id=n.event_id where n.id=${id}::uuid and n.user_id=${userId}`);
 if(!row)return {author:null,chart:null,state:"unavailable",occurredAt:new Date(0).toISOString()};
 const [chart]=await getPublicChartsByIds(ctx,[row.chart_id]);
 if(!chart||!row.author_id||chart.author?.id!==row.author_id||!chart.author.publicId)return {author:null,chart:null,state:"unavailable",occurredAt:stamp(row.event_at)};
 return {author:{...chart.author,publicId:chart.author.publicId},chart,state:chart.versionId===row.version_id?"current":"updated",occurredAt:stamp(row.event_at)};
}
export async function followingStatus(ctx:Pick<StorageContext,"db">):Promise<FollowingStatus> {
 const [r]=await rows<{ready:boolean;failures:number;last_success_at:Date|null;last_failure_at:Date|null;pending_events:number;oldest:number|null;pending_controls:number}>(ctx.db,sql`select s.*,
  (select count(*)::int from community_publication_events where not completed and notify) pending_events,
  (select greatest(0,extract(epoch from clock_timestamp()-min(occurred_at)))::float8 from community_publication_events where not completed and notify) oldest,
  (select count(*)::int from community_private_states where journal_sequence>${exported}) pending_controls
  from community_following_status s where id='global'`);
 return {ready:!!r?.ready,pendingEvents:r?.pending_events??0,oldestPendingSeconds:r?.oldest??null,pendingControls:r?.pending_controls??0,failures:r?.failures??0,lastSuccessAt:r?.last_success_at?stamp(r.last_success_at):null,lastFailureAt:r?.last_failure_at?stamp(r.last_failure_at):null};
}
export async function registerFollowingWorker(ctx:StorageContext,boss:PgBoss) {
 await boss.work(FOLLOWING_DISPATCH_QUEUE,async()=>runStorageWork(ctx,()=>dispatchFollowingUpdates(ctx)));
 await boss.schedule(FOLLOWING_DISPATCH_QUEUE,"* * * * *",{});
}

/** Privacy is immediate through account joins; physical cleanup is bounded independently of graph size. */
export async function cleanupFollowingOrphans(ctx:StorageContext) {
 await withStorageTransaction(ctx.db,async tx=>{
  await tx.execute(sql`delete from community_follows where id in(select f.id from community_follows f where not exists(select 1 from "user" u where u.id=f.user_id) or not exists(select 1 from "user" u where u.id=f.author_id) limit 500)`);
  await tx.execute(sql`delete from community_update_notifications where id in(select n.id from community_update_notifications n where not exists(select 1 from "user" u where u.id=n.user_id) limit 500)`);
  await tx.execute(sql`delete from community_update_deliveries where (event_id,user_id) in(select d.event_id,d.user_id from community_update_deliveries d where not exists(select 1 from "user" u where u.id=d.user_id) limit 500)`);
  await tx.execute(sql`update community_update_notifications set author_id=null where id in(select n.id from community_update_notifications n where n.author_id is not null and not exists(select 1 from "user" u where u.id=n.author_id) limit 500)`);
  await tx.execute(sql`update community_publication_events set author_id=null,completed=true where id in(select e.id from community_publication_events e where e.author_id is not null and not exists(select 1 from "user" u where u.id=e.author_id) limit 500)`);
  await tx.execute(sql`delete from community_private_states where key in(select s.key from community_private_states s where s.entity<>'account' and ((s.fact ? 'userId' and not exists(select 1 from "user" u where u.id=s.fact->>'userId')) or (s.fact->>'authorId' is not null and not exists(select 1 from "user" u where u.id=s.fact->>'authorId'))) limit 500)`);
 });
}
