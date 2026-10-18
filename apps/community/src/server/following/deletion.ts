import { eq, sql } from "drizzle-orm";
import type { Client } from "pg";
import type { DeletionHandler } from "../services/user-deletion";
import type { StorageContext } from "../storage/contracts";
import { communityFollowingAccounts } from "../db/schema";
import { storageTime } from "../storage/usage";
import { recordPrivateFact, awaitPrivateJournal } from "./journal";
import { purgeFollowingUser } from "../../../ops/backup/following-replay";
export function followingDeletionHandler(ctx:StorageContext):DeletionHandler {
 return {name:"following",hasContent:async()=>false,
  prepare:async(userId,tx)=>{
   const [old]=await tx.select().from(communityFollowingAccounts).where(eq(communityFollowingAccounts.userId,userId));
   const cutoffAt=await storageTime(tx),revision=(old?.revision??0)+1;
   const sequence=await recordPrivateFact(tx,{version:1,entity:"account",id:userId,revision,cutoffAt:cutoffAt.toISOString()});
   await tx.insert(communityFollowingAccounts).values({userId,revision,cutoffAt,journalSequence:sequence})
    .onConflictDoUpdate({target:communityFollowingAccounts.userId,set:{revision,cutoffAt,journalSequence:sequence}});
  },
  afterPrepare:async userId=>{const [row]=await ctx.db.select().from(communityFollowingAccounts).where(eq(communityFollowingAccounts.userId,userId));if(row)await awaitPrivateJournal(ctx,row.journalSequence);},
  purge:async(userId,_options,tx)=>{
   await purgeFollowingUser({query:((text:string,params:unknown[])=>{const chunks=text.split(/\$1/g);return tx.execute(sql.join(chunks.flatMap((chunk,index)=>index?[sql`${params[0]}`,sql.raw(chunk)]:[sql.raw(chunk)]),sql``));}) as Client["query"]},userId);
  }};
}
