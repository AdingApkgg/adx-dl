import { expect } from "bun:test";
import { eq,sql } from "drizzle-orm";
import type { StorageContext } from "../../src/server/storage/contracts";
import { user,userPublicIds } from "../../src/server/db/schema";
import { getFollow,setFollow,listFollowing } from "../../src/server/following/relationships";
import { listFeed } from "../../src/server/following/events";
import { dispatchFollowingUpdates,followingStatus } from "../../src/server/following/notifications";
import { listNotifications,readNotifications } from "../../src/server/discussions/notifications";
import { createDeletionHandlers } from "../../src/server/storage/deletion";
import { requestDeletion,purgeUser } from "../../src/server/services/user-deletion";
/** Real encrypted tail after a real dump: cancellation, muted alerts, read watermarks and purge. */
export async function followingRestoreFixture(ctx:StorageContext,owner:()=>Promise<string>,authorId:string) {
 const subscriber=await owner(),muted=await owner(),cancelled=await owner(),doomed=await owner();
 await ctx.exportChartJournal!();
 const [identity]=await ctx.db.select().from(userPublicIds).where(eq(userPublicIds.userId,authorId));
 const number=identity.publicId.toString(),states=new Map<string,Awaited<ReturnType<typeof getFollow>>>();
 for(const id of [subscriber,muted,cancelled,doomed])states.set(id,await setFollow(ctx,id,number,{expectedRevision:0,following:true,notify:true}));
 let readId="",mutedId="";
 return {
  cases:["private-follow-cancel-survives-old-dump","private-alert-disable-survives-old-dump","private-read-watermark-survives-old-dump","private-follow-user-purge","private-update-outbox-not-redelivered"],
  async afterInitialPublication(){
   for(let i=0;i<5;i++)await dispatchFollowingUpdates(ctx);
   const a=await listNotifications(ctx,subscriber,{kind:"author_update"}),b=await listNotifications(ctx,muted,{kind:"author_update"});
   expect(a.items).toHaveLength(1);expect(b.items).toHaveLength(1);readId=a.items[0]!.id;mutedId=b.items[0]!.id;
  },
  async commitLaterFacts(){
   await readNotifications(ctx,subscriber,[readId]);
   await setFollow(ctx,muted,number,{expectedRevision:states.get(muted)!.revision,following:true,notify:false});
   await setFollow(ctx,cancelled,number,{expectedRevision:states.get(cancelled)!.revision,following:false,notify:false});
   const handlers=createDeletionHandlers(ctx);
   await requestDeletion({db:ctx.db,boss:ctx.boss,handlers},doomed,{deleteContent:false});
   await ctx.db.update(user).set({deletionPurgeAt:new Date(Date.now()-1000)}).where(eq(user.id,doomed));
   expect(await purgeUser({db:ctx.db,handlers},doomed)).toBe("purged");
  },
  async verify(target:StorageContext){
   expect(await getFollow(target,cancelled,number)).toMatchObject({following:false,notify:false});
   expect(await getFollow(target,muted,number)).toMatchObject({following:true,notify:false});
   expect((await listFollowing(target,cancelled)).items).toHaveLength(0);expect((await listFeed(target,cancelled)).items).toHaveLength(0);
   const inbox=await listNotifications(target,subscriber,{kind:"author_update"});expect(inbox.items.find(i=>i.id===readId)?.read).toBe(true);
   expect((await listNotifications(target,subscriber,{unread:true})).items.some(i=>i.id===readId)).toBe(false);
   expect((await listNotifications(target,muted,{kind:"author_update"})).items.map(i=>i.id)).toEqual([mutedId]);
   expect((await target.db.select().from(user).where(eq(user.id,doomed))).length).toBe(0);
   const orphan=await target.db.execute(sql`select 1 from community_follows where user_id=${doomed} or author_id=${doomed}`);expect(orphan.rows).toHaveLength(0);
   expect((await followingStatus(target)).ready).toBe(true);
   const before=(await listNotifications(target,subscriber,{kind:"author_update"})).items.map(i=>({id:i.id,read:i.read}));
   await dispatchFollowingUpdates(target);await dispatchFollowingUpdates(target);
   expect((await listNotifications(target,subscriber,{kind:"author_update"})).items.map(i=>({id:i.id,read:i.read}))).toEqual(before);
   expect((await followingStatus(target)).pendingEvents).toBe(0);
  },
 };
}
