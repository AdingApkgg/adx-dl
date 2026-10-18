import type { Client } from "pg";
import { privateSocialFact } from "../../src/shared/private-social-journal";
import { communityHash } from "../../src/server/community/content-journal";
import type { JournalRecord } from "./journal";
/** Applied only to the closed target DB. Current public visibility is never taken from this private log. */
export async function replayFollowingFact(c:Pick<Client,"query">,record:JournalRecord) {
 const fact=privateSocialFact.parse(record.payload),key=`${fact.entity}:${fact.id}`;
 const old=await c.query("select revision,fact from community_private_states where key=$1 for update",[key]);
 if(old.rowCount&&old.rows[0].revision===fact.revision&&communityHash(old.rows[0].fact)!==communityHash(fact))throw new Error("PRIVATE_SOCIAL_JOURNAL_CONFLICT");
 // Delivery proof is independent from a newer group's state and survives late replay.
 if(fact.entity==="notification")await c.query(`insert into community_update_deliveries(event_id,user_id,journal_sequence)
  select $1,$2,$3 where exists(select 1 from "user" where id=$2) on conflict do nothing`,[fact.eventId,fact.userId,record.sequence]);
 if(old.rowCount&&old.rows[0].revision>fact.revision)return;
 if(fact.entity==="follow") {
  await c.query(`insert into community_follows(id,user_id,author_id,revision,followed_at,notify_since,updated_at,journal_sequence)
   select $1,$2,$3,$4,$5,$6,$7,$8 where exists(select 1 from "user" where id=$2) and exists(select 1 from "user" where id=$3)
   on conflict(user_id,author_id) do update set revision=excluded.revision,followed_at=excluded.followed_at,notify_since=excluded.notify_since,updated_at=excluded.updated_at,journal_sequence=excluded.journal_sequence where community_follows.revision<=excluded.revision`,
   [fact.id,fact.userId,fact.authorId,fact.revision,fact.followedAt,fact.notifySince,fact.updatedAt,record.sequence]);
 } else if(fact.entity==="account") {
  await c.query(`insert into community_following_accounts(user_id,revision,cutoff_at,journal_sequence) values($1,$2,$3,$4)
   on conflict(user_id) do update set revision=excluded.revision,cutoff_at=excluded.cutoff_at,journal_sequence=excluded.journal_sequence where community_following_accounts.revision<=excluded.revision`,[fact.id,fact.revision,fact.cutoffAt,record.sequence]);
 } else if(fact.entity==="publication") {
  const prior=await c.query("select id from community_publication_events where chart_id=$1 and version_id=$2",[fact.chartId,fact.versionId]);
  if(prior.rowCount&&prior.rows[0].id!==fact.id)throw new Error("PUBLICATION_EVENT_ID_CONFLICT");
  // Replayed events are facts for history/feed, never an instruction to resend snapshot-era updates.
  await c.query(`insert into community_publication_events(id,chart_id,version_id,author_id,occurred_at,permission_sequence,journal_sequence,notify,completed)
   values($1,$2,$3,(select id from "user" where id=$4),$5,$6,$7,$8,true)
   on conflict(chart_id,version_id) do update set journal_sequence=excluded.journal_sequence,completed=true`,[fact.id,fact.chartId,fact.versionId,fact.authorId,fact.occurredAt,fact.permissionSequence,record.sequence,fact.notify]);
 } else {
  // Resolve uniqueness before restoring the latest unread author group; an older read group stays read.
  await c.query(`update community_update_notifications set read_at=coalesce(read_at,$4::timestamptz) where user_id=$1 and author_id=$2 and id<>$3 and read_at is null and event_at<=$4::timestamptz`,[fact.userId,fact.authorId,fact.id,fact.eventAt]);
  await c.query(`insert into community_update_notifications(id,user_id,author_id,event_id,event_at,created_at,read_at,revision,journal_sequence)
   select $1,$2,(select id from "user" where id=$3),$4,$5,$6,$7,$8,$9 where exists(select 1 from "user" where id=$2)
    and not exists(select 1 from community_update_notifications newer where newer.user_id=$2 and newer.author_id is not distinct from $3::text and newer.id<>$1
      and (newer.event_at,newer.event_id)>($5::timestamptz,$4::uuid))
   on conflict(id) do update set event_id=excluded.event_id,event_at=excluded.event_at,read_at=excluded.read_at,revision=excluded.revision,journal_sequence=excluded.journal_sequence where community_update_notifications.revision<=excluded.revision`,
   [fact.id,fact.userId,fact.authorId,fact.eventId,fact.eventAt,fact.createdAt,fact.readAt,fact.revision,record.sequence]);
 }
 await c.query(`insert into community_private_states(key,entity,revision,fact,journal_sequence) values($1,$2,$3,$4,$5)
  on conflict(key) do update set revision=excluded.revision,fact=excluded.fact,journal_sequence=excluded.journal_sequence where community_private_states.revision<=excluded.revision`,[key,fact.entity,fact.revision,JSON.stringify(fact),record.sequence]);
}
export async function finishFollowingReplay(c:Pick<Client,"query">,durable:number) {
 await c.query("update community_publication_events set completed=true where not completed");
 // An old dump may include an unacknowledged control ahead of the durable witness.
 // Disable only this private subsystem; public browsing must not guess its state.
 await c.query(`update community_following_status set ready=not exists(select 1 from community_private_states where journal_sequence>$1)
  and not exists(select 1 from community_follows where journal_sequence>$1)
  and not exists(select 1 from community_following_accounts where journal_sequence>$1)
  and not exists(select 1 from community_update_notifications where journal_sequence>$1)
  and not exists(select 1 from community_update_deliveries where journal_sequence>$1)
  and not exists(select 1 from community_publication_events where journal_sequence>$1) where id='global'`,[durable]);
}
/** At most 500 rows per projection; remaining orphans are invisible and drained by the control worker. */
export async function purgeFollowingUser(c:Pick<Client,"query">,userId:string) {
 await c.query("delete from community_follows where id in(select id from community_follows where user_id=$1 or author_id=$1 limit 500)",[userId]);
 await c.query("delete from community_update_notifications where id in(select id from community_update_notifications where user_id=$1 limit 500)",[userId]);
 await c.query("delete from community_update_deliveries where (event_id,user_id) in(select event_id,user_id from community_update_deliveries where user_id=$1 limit 500)",[userId]);
 await c.query("update community_update_notifications set author_id=null where id in(select id from community_update_notifications where author_id=$1 limit 500)",[userId]);
 await c.query("update community_publication_events set author_id=null,completed=true where id in(select id from community_publication_events where author_id=$1 limit 500)",[userId]);
 await c.query("delete from community_private_states where key in(select key from community_private_states where entity<>'account' and (fact->>'userId'=$1 or fact->>'authorId'=$1) limit 500)",[userId]);
}
