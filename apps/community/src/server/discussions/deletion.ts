import { sql } from "drizzle-orm";
import type { Client } from "pg";
import { readCommunityFact } from "../community/content-journal";
import type { DeletionHandler } from "../services/user-deletion";
import type { DbTransaction } from "../storage/contracts";
import { rows, contentFact, controlFact, type TopicRow, type MessageRow } from "./core";
/** Called inside the recovery transaction BEFORE the user row disappears. No body is reconstructed. */
export async function replayDiscussionUserDeletion(c:Pick<Client,"query">,userId:string) {
 await c.query(`update discussion_reports set evidence_title=null,evidence_body=null,target_author_id=null where target_author_id=$1`,[userId]);
 await c.query(`delete from discussion_reports where reporter_id=$1`,[userId]);
 await c.query(`delete from discussion_notifications where user_id=$1`,[userId]);
 await c.query(`delete from discussion_deliveries where user_id=$1`,[userId]);
 await c.query(`delete from discussion_subscriptions where user_id=$1`,[userId]);
 await c.query(`delete from discussion_requests where user_id=$1`,[userId]);
 await c.query(`delete from discussion_outbox where actor_id=$1 or recipient_id=$1`,[userId]);
 await c.query(`update discussion_decisions set recipient_id=null where recipient_id=$1`,[userId]);
 await c.query(`update discussion_decisions set actor_id=null where actor_id=$1`,[userId]);
 await c.query(`update discussion_messages set body=null,content_hash='',author_id=null,timestamp_ms=null,state=case when state='hidden' then 'hidden' else 'deleted' end where author_id=$1`,[userId]);
 await c.query(`update discussion_topics t set title=null,body=null,content_hash='',author_id=null,locked=true,pin=null,state=case when t.state='hidden' then 'hidden' when exists(select 1 from discussion_messages m where m.topic_id=t.id and m.author_id is distinct from $1 and m.state<>'deleted') then 'root_removed' else 'deleted' end where t.author_id=$1`,[userId]);
}
export async function purgeDiscussionUser(tx:DbTransaction,userId:string) {
 const messages=await rows<MessageRow>(tx,sql`select * from discussion_messages where author_id=${userId} and state='visible' for update`);
 for(const m of messages){const latest=await readCommunityFact(tx,"message",m.id);if(latest&&["hidden","deleted"].includes(latest.fact.state))continue;m.revision=Math.max(m.revision,latest?.fact.revision??0);const [r]=await rows<MessageRow>(tx,sql`update discussion_messages set body=null,content_hash='',timestamp_ms=null,state='deleted',revision=${m.revision+1} where id=${m.id}::uuid returning *`);await contentFact(tx,"message",r,"deleted");}
 const topics=await rows<TopicRow>(tx,sql`select * from discussion_topics where author_id=${userId} and state='visible' for update`);
 for(const t of topics){const latest=await readCommunityFact(tx,"topic",t.id),control=await readCommunityFact(tx,"topic_control",t.id);if(latest&&["hidden","deleted","root_removed"].includes(latest.fact.state))continue;t.revision=Math.max(t.revision,latest?.fact.revision??0);t.control_revision=Math.max(t.control_revision,control?.fact.revision??0);t.board_id=control?.fact.controls?.board??t.board_id;const [other]=await rows(tx,sql`select 1 from discussion_messages where topic_id=${t.id}::uuid and author_id is distinct from ${userId} and state<>'deleted' limit 1`);const state=other?"root_removed":"deleted";const [r]=await rows<TopicRow>(tx,sql`update discussion_topics set title=null,body=null,content_hash='',state=${state},locked=true,pin=null,revision=${t.revision+1},control_revision=${t.control_revision+1},board_id=${t.board_id} where id=${t.id}::uuid returning *`);await contentFact(tx,"topic",r,state);await controlFact(tx,r);}
 // Use a bridge to keep live purge and raw-pg replay cleanup byte-for-byte equivalent.
 await replayDiscussionUserDeletion({query:((text:string,params:unknown[])=>{const chunks=text.split(/\$1/g);return tx.execute(sql.join(chunks.flatMap((chunk,index)=>index? [sql`${params[0]}`,sql.raw(chunk)]:[sql.raw(chunk)]),sql``));}) as Client["query"]},userId);
}
export const discussionDeletionHandler:DeletionHandler={name:"discussions",hasContent:async(userId,db)=>!!(await rows(db,sql`select 1 from discussion_topics where author_id=${userId} union all select 1 from discussion_messages where author_id=${userId} limit 1`)).length,purge:async(userId,_options,tx)=>{await purgeDiscussionUser(tx,userId);}};
