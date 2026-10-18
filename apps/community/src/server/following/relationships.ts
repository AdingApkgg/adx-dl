import { sql } from "drizzle-orm";
import type { FollowInput, FollowingItem, FollowState } from "@/shared/following";
import { FOLLOWING_LIMIT } from "@/shared/following";
import { isPublicChartId } from "@/shared/chart-public-id";
import { communityFollows } from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import { requireActiveSocialUser } from "../services/social-page";
import { storageTime } from "../storage/usage";
import { recordPrivateFact, awaitPrivateJournal } from "./journal";
import { assertFollowingReady, changed, effectiveFollow, exported, followingScope, followingPage, missing, rows, stamp, withFollowingPair, type FollowRow, type Handle } from "./core";
import { StorageError } from "../storage/errors";
async function authorIdentity(db:Handle,publicId:string) {
 if(!isPublicChartId(publicId))throw missing();
 const [target]=await rows<{id:string;status:string}>(db,sql`select u.id,u.status from user_public_ids p join "user" u on u.id=p.user_id where p.public_id=${publicId}::bigint and p.journal_sequence<=${exported}`);
 if(!target)throw missing();return target;
}
async function state(db:Handle,userId:string,authorId:string):Promise<FollowState> {
 const [row]=await rows<FollowRow&{effective:boolean}>(db,sql`select f.*,(${effectiveFollow()}) effective from community_follows f where f.user_id=${userId} and f.author_id=${authorId}`);
 return {revision:row?.revision??0,following:!!row?.effective,notify:!!(row?.effective&&row.notify_since),followedAt:row?.effective&&row.followed_at?stamp(row.followed_at):null};
}
export async function getFollow(ctx:StorageContext,userId:string,publicId:string) {
 await requireActiveSocialUser(ctx.db,userId);await assertFollowingReady(ctx.db,userId);
 const target=await authorIdentity(ctx.db,publicId);
 if(target.id===userId)return {revision:0,following:false,notify:false,followedAt:null};
 const result=await state(ctx.db,userId,target.id);
 return target.status==="active"?result:{...result,following:false,notify:false,followedAt:null};
}
export async function setFollow(ctx:StorageContext,userId:string,publicId:string,input:FollowInput):Promise<FollowState> {
 const target=await authorIdentity(ctx.db,publicId);
 if(!input.following&&input.notify)throw changed();
 const sequence=await withFollowingPair(ctx,userId,target.id,input.following,async tx=>{
  const [prior]=await rows<FollowRow&{effective:boolean}>(tx,sql`select f.*,(${effectiveFollow()}) effective from community_follows f where f.user_id=${userId} and f.author_id=${target.id} for update`);
  const active=!!prior?.effective,notify=!!(active&&prior.notify_since);
  // A lost success response can retry its intended final state without toggling it.
  if(active===input.following&&notify===input.notify)return prior?.journal_sequence??0;
  if((prior?.revision??0)!==input.expectedRevision||(prior?.revision??0)>=2147483646)throw changed();
  if(input.following&&!active){const [count]=await rows<{n:number}>(tx,sql`select count(*)::int n from community_follows f join "user" a on a.id=f.author_id and a.status='active' where f.user_id=${userId} and ${effectiveFollow()}`);if(count.n>=FOLLOWING_LIMIT)throw new StorageError(429,"FOLLOWING_LIMIT","FOLLOWING_LIMIT",60);}
  const now=await storageTime(tx),followedAt=input.following?(active?prior!.followed_at!:now):null;
  const notifySince=input.following&&input.notify?(active&&prior?.notify_since?prior.notify_since:now):null;
  const id=prior?.id??crypto.randomUUID(),revision=(prior?.revision??0)+1;
  const sequence=await recordPrivateFact(tx,{version:1,entity:"follow",id,userId,authorId:target.id,revision,followedAt:followedAt?stamp(followedAt):null,notifySince:notifySince?stamp(notifySince):null,updatedAt:stamp(now)});
  await tx.insert(communityFollows).values({id,userId,authorId:target.id,revision,followedAt,notifySince,updatedAt:now,journalSequence:sequence})
   .onConflictDoUpdate({target:[communityFollows.userId,communityFollows.authorId],set:{revision,followedAt,notifySince,updatedAt:now,journalSequence:sequence}});
  return sequence;
 });
 await awaitPrivateJournal(ctx,sequence);
 return getFollow(ctx,userId,publicId);
}
export async function listFollowing(ctx:StorageContext,userId:string,cursor?:string) {
 await requireActiveSocialUser(ctx.db,userId);await assertFollowingReady(ctx.db,userId);
 const p=followingPage(cursor,`following:${userId}:${await followingScope(ctx.db,userId)}`);
 const result=await rows<FollowRow&{public_id:string;name:string;image:string|null}>(ctx.db,sql`select f.*,p.public_id::text,u.name,u.image from community_follows f join "user" u on u.id=f.author_id and u.status='active'
  join user_public_ids p on p.user_id=u.id and p.journal_sequence<=${exported} where f.user_id=${userId} and ${effectiveFollow()} and f.journal_sequence<=${exported}
  ${p.cursor?sql`and (f.followed_at,f.id)<(${p.cursor.at}::timestamptz,${p.cursor.id}::uuid)`:sql``} order by f.followed_at desc,f.id desc limit 21`);
 const items:FollowingItem[]=result.slice(0,20).map(r=>({id:r.id,revision:r.revision,following:true,notify:!!r.notify_since,followedAt:stamp(r.followed_at!),author:{id:r.author_id,publicId:r.public_id,name:r.name,image:r.image}}));
 const last=result[19];return {items,nextCursor:result.length>20&&last?p.encode(last.followed_at!,last.id):null};
}
