import { socialPage } from "../services/social-page";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { StorageError, StorageUnavailableError } from "../storage/errors";
import type { Db } from "../db/client";
import type { DbTransaction, StorageContext } from "../storage/contracts";
import { withStorageTransaction } from "../storage/transactions";
import { rows, exported } from "../discussions/core";
export { rows, exported, stamp } from "../discussions/core";
export type Handle=Db|DbTransaction;
export type FollowRow={id:string;user_id:string;author_id:string;revision:number;followed_at:Date|null;notify_since:Date|null;updated_at:Date;journal_sequence:number};
export type EventRow={id:string;chart_id:string;version_id:string;author_id:string|null;occurred_at:Date;permission_sequence:number;journal_sequence:number;notify:boolean;cursor:string|null;completed:boolean};
export type UpdateRow={id:string;user_id:string;author_id:string|null;event_id:string;event_at:Date;created_at:Date;read_at:Date|null;revision:number;journal_sequence:number};
export const missing=()=>new StorageError(404,"NOT_FOUND");
export const changed=()=>new StorageError(409,"FOLLOWING_CHANGED");
/** Both account cutoffs invalidate old relationships, even after deletion is cancelled. */
export function effectiveFollow(alias="f") {
 const a=sql.raw(alias);
 return sql`${a}.followed_at is not null and ${a}.journal_sequence>coalesce((select journal_sequence from community_following_accounts where user_id=${a}.user_id),0)
 and ${a}.journal_sequence>coalesce((select journal_sequence from community_following_accounts where user_id=${a}.author_id),0)`;
}
export async function assertFollowingReady(db:Handle,userId?:string) {
 const [status]=await rows<{ready:boolean}>(db,sql`select ready from community_following_status where id='global'`);
 if(!status?.ready)throw new StorageUnavailableError();
 if(userId){const [pending]=await rows(db,sql`select 1 from community_private_states where journal_sequence>${exported}
  and (fact->>'userId'=${userId} or (entity='account' and fact->>'id'=${userId})) limit 1`);if(pending)throw new StorageUnavailableError();}
}
export async function withFollowingPair<T>(ctx:StorageContext,userId:string,authorId:string,activeAuthor:boolean,run:(tx:DbTransaction)=>Promise<T>) {
 if(userId===authorId)throw new HTTPException(400,{message:"Cannot follow yourself"});
 return withStorageTransaction(ctx.db,async tx=>{
  // One deterministic order for follow, delivery, deletion and reciprocal relationships.
  const accounts=await rows<{id:string;status:string}>(tx,sql`select id,status from "user" where id in (${userId},${authorId}) order by id for update`);
  if(accounts.find(a=>a.id===userId)?.status!=="active")throw new HTTPException(403);
  if(activeAuthor&&accounts.find(a=>a.id===authorId)?.status!=="active")throw missing();
  await assertFollowingReady(tx);
  return run(tx);
 });
}
export async function followingScope(db:Handle,userId:string) {
 const [row]=await rows<{scope:string}>(db,sql`select md5(
  coalesce((select journal_sequence::text from community_follows where user_id=${userId} order by journal_sequence desc limit 1),'0')||':'||
  coalesce((select journal_sequence::text from community_following_accounts order by journal_sequence desc limit 1),'0')) scope`);
 return row?.scope??"empty";
}

export function followingPage(cursor:string|undefined,scope:string){try{return socialPage({cursor,limit:20},scope);}catch{throw changed();}}
