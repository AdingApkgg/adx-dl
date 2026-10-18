import { beforeAll,afterAll,expect,test } from "bun:test";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { eq,inArray,sql } from "drizzle-orm";
import { Client } from "pg";
import { initializeJournal,exportJournal,verifyLatestJournal,type JournalConfig } from "../../../ops/backup/journal";
import { replayFollowingFact,finishFollowingReplay } from "../../../ops/backup/following-replay";
import { readyContext,readyOwner } from "../../../test/storage/ready-file";
import { followingChartFiles } from "../../../test/storage/following-fixture";
import { cleanupStorageFixture } from "../../../test/storage/fixture";
import { resetTestDatabase } from "../testing/test-db";
import { prepareTestQueues } from "../testing/test-boss";
import { testDatabaseUrl } from "../testing/services";
import { storageJournalProgress,userPublicIds,user,communityFollowingStatus,charts,chartVersions,chartPublications } from "../db/schema";
import { createChart,appendChartVersion,updateChart } from "../charts/service";
import { publishChart,withdrawChart } from "../charts/publication";
import { withStorageTransaction } from "../storage/transactions";
import { getFollow,setFollow,listFollowing } from "./relationships";
import { listFeed,publicationEventId } from "./events";
import { dispatchFollowingUpdates,followingStatus } from "./notifications";
import { listNotifications,readNotifications } from "../discussions/notifications";
import { recordPrivateFact } from "./journal";
import { requestDeletion,cancelDeletion } from "../services/user-deletion";
import { followingDeletionHandler } from "./deletion";
let f:Awaited<ReturnType<typeof readyContext>>,file:ReturnType<typeof followingChartFiles>,journal:JournalConfig,directory:string;
const owners:string[]=[];
async function owner(){const id=await readyOwner(f.ctx);owners.push(id);await f.ctx.exportChartJournal!();const [p]=await f.ctx.db.select().from(userPublicIds).where(eq(userPublicIds.userId,id));return {id,number:p.publicId.toString()};}
async function release(author:string,chart?:Awaited<ReturnType<typeof createChart>>) {
 const source=await file(author);
 const draft=chart?await appendChartVersion(f.ctx,author,chart.id,{expectedRevision:chart.revision,fileId:source.id}):await createChart(f.ctx,author,source.id);
 return publishChart(f.ctx,author,draft.id,{expectedRevision:draft.revision,versionId:draft.currentVersionId!,confirmOriginalArchive:true});
}
async function dispatch(){for(let i=0;i<5;i++)await dispatchFollowingUpdates(f.ctx);}
beforeAll(async()=>{
 await resetTestDatabase();await prepareTestQueues();f=await readyContext();file=followingChartFiles(f);directory=await mkdtemp("/tmp/following-journal-");const keyFile=`${directory}/key`;await writeFile(keyFile,crypto.getRandomValues(new Uint8Array(32)),{mode:0o600});journal={directory:`${directory}/log`,keyFile,databaseUrl:testDatabaseUrl()};
 await f.ctx.db.update(storageJournalProgress).set({exportedSequence:0,chainHash:null,exportedAt:null}).where(eq(storageJournalProgress.id,"global"));await initializeJournal(journal);f.ctx.exportChartJournal=async()=>{await exportJournal(journal);};
},30000);
afterAll(async()=>{if(f){await f.ctx.db.update(communityFollowingStatus).set({ready:true}).where(eq(communityFollowingStatus.id,"global"));const own=await f.ctx.db.select({id:charts.id}).from(charts).where(inArray(charts.ownerId,owners));const ids=own.map(c=>c.id);if(ids.length){await f.ctx.db.delete(chartPublications).where(inArray(chartPublications.chartId,ids));await f.ctx.db.update(charts).set({currentVersionId:null}).where(inArray(charts.id,ids));await f.ctx.db.delete(chartVersions).where(inArray(chartVersions.chartId,ids));await f.ctx.db.delete(charts).where(inArray(charts.id,ids));}await cleanupStorageFixture(f.ctx.db,owners,[f.policy.id],undefined,true);}if(directory)await rm(directory,{recursive:true,force:true});},30000);

test("private follow is idempotent, optimistic and cannot follow self",async()=>{
 const a=await owner(),b=await owner();
 await expect(setFollow(f.ctx,a.id,a.number,{expectedRevision:0,following:true,notify:false})).rejects.toMatchObject({status:400});
 const state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false});expect(state).toMatchObject({revision:1,following:true,notify:false});
 expect(await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false})).toEqual(state);
 const cancelled=await setFollow(f.ctx,b.id,a.number,{expectedRevision:1,following:false,notify:false});expect(cancelled.following).toBe(false);
 await expect(setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false})).rejects.toMatchObject({status:409});
 expect((await listFollowing(f.ctx,a.id)).items).toHaveLength(0);
 expect((await listFollowing(f.ctx,b.id)).items).toHaveLength(0);
});
test("new follow can browse past public feed but never receives history; drafts do not emit events",async()=>{
 const a=await owner(),b=await owner(),chart=await release(a.id);
 await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});
 await dispatch();expect((await listNotifications(f.ctx,b.id,{})).unreadCount).toBe(0);
 expect((await listFeed(f.ctx,b.id)).items.map(i=>i.chart.id)).toContain(chart.id);
 const source=await file(a.id,"Still private"),draft=await appendChartVersion(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,fileId:source.id});
 expect((await listFeed(f.ctx,b.id)).items[0]?.chart.versionId).toBe(chart.publication!.versionId);
 expect((await f.ctx.db.execute(sql`select count(*)::int n from community_publication_events where chart_id=${chart.id}::uuid`)).rows[0]?.n).toBe(1);
 expect(draft.currentVersionId).not.toBe(chart.publication!.versionId);
});
test("new releases aggregate by author, durable read blocks late replay, changed version has explicit current link",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});
 let chart=await release(a.id);await dispatch();let inbox=await listNotifications(f.ctx,b.id,{kind:"author_update"});expect(inbox.items).toHaveLength(1);expect(inbox.items[0]?.update?.state).toBe("current");
 const first=inbox.items[0]!.id;chart=await release(a.id,chart);await dispatch();inbox=await listNotifications(f.ctx,b.id,{});expect(inbox.items).toHaveLength(1);expect(inbox.items[0]?.id).toBe(first);
 await readNotifications(f.ctx,b.id,[first]);await dispatch();expect((await listNotifications(f.ctx,b.id,{unread:true})).items).toHaveLength(0);
 chart=await release(a.id,chart);await dispatch();inbox=await listNotifications(f.ctx,b.id,{});expect(inbox.items).toHaveLength(2);expect(inbox.items.find(n=>n.id===first)?.update?.state).toBe("updated");
 expect(inbox.items.find(n=>n.id===first)?.href).toBe(`/charts/${chart.publicId}`);
});
test("metadata, withdraw/republish and older public version do not mint duplicate events",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});
 let chart=await release(a.id);const version=chart.currentVersionId!;await dispatch();
 const first=(await listNotifications(f.ctx,b.id,{})).items[0]!;await readNotifications(f.ctx,b.id,[first.id]);
 chart=await updateChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,title:"Metadata only",artist:"Artist"});
 chart=await publishChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,versionId:version,confirmOriginalArchive:true});
 chart=await withdrawChart(f.ctx,a.id,chart.id,chart.revision);expect((await listFeed(f.ctx,b.id)).items).toHaveLength(0);
 chart=await publishChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,versionId:version,confirmOriginalArchive:true});await dispatch();
 expect((await listNotifications(f.ctx,b.id,{unread:true})).items).toHaveLength(0);
 expect((await f.ctx.db.execute(sql`select count(*)::int n from community_publication_events where chart_id=${chart.id}::uuid`)).rows[0]?.n).toBe(1);
 expect(publicationEventId(chart.id,version)).toMatch(/^[\da-f-]{14}5[\da-f-]+$/);
});
test("turning alerts on after publication or refollowing does not admit delayed old events",async()=>{
 const a=await owner(),b=await owner();let state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false});
 let chart=await release(a.id);state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:state.revision,following:true,notify:true});await dispatch();expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(0);
 chart=await release(a.id,chart);state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:state.revision,following:false,notify:false});state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:state.revision,following:true,notify:true});await dispatch();
 expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(0);expect(state.following).toBe(true);
});
test("pending deletion cutoff survives cancellation and journal replay; no relationship revival",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});const handler=followingDeletionHandler(f.ctx);
 await withStorageTransaction(f.ctx.db,async tx=>{await tx.update(user).set({status:"pending_deletion"}).where(eq(user.id,a.id));await handler.prepare!(a.id,tx);});await handler.afterPrepare!(a.id);
 await f.ctx.db.update(user).set({status:"active"}).where(eq(user.id,a.id));expect((await getFollow(f.ctx,b.id,a.number)).following).toBe(false);
 const records=(await verifyLatestJournal(journal)).records.filter(r=>r.kind==="private_social");
 await f.ctx.db.execute(sql`delete from community_following_accounts where user_id=${a.id}`);
 const c=new Client({connectionString:testDatabaseUrl()});await c.connect();try{for(const record of records)await replayFollowingFact(c,record);}finally{await c.end();}
 expect((await getFollow(f.ctx,b.id,a.number)).following).toBe(false);
});
test("read and cancellation after a snapshot overwrite stale projection facts without duplicate unread",async()=>{
 const a=await owner(),b=await owner();let state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});await release(a.id);await dispatch();
 const [notice]=(await listNotifications(f.ctx,b.id,{})).items;await readNotifications(f.ctx,b.id,[notice!.id]);state=await setFollow(f.ctx,b.id,a.number,{expectedRevision:state.revision,following:false,notify:false});
 const verified=await verifyLatestJournal(journal),records=verified.records.filter(r=>r.kind==="private_social");
 await f.ctx.db.execute(sql`delete from community_private_states where fact->>'userId'=${b.id}`);await f.ctx.db.execute(sql`delete from community_follows where user_id=${b.id}`);await f.ctx.db.execute(sql`delete from community_update_notifications where user_id=${b.id}`);await f.ctx.db.execute(sql`delete from community_update_deliveries where user_id=${b.id}`);
 const c=new Client({connectionString:testDatabaseUrl()});await c.connect();try{for(const r of records)await replayFollowingFact(c,r);await finishFollowingReplay(c,verified.head.sequence);}finally{await c.end();}
 expect((await getFollow(f.ctx,b.id,a.number)).following).toBe(false);expect((await listNotifications(f.ctx,b.id,{unread:true})).items).toHaveLength(0);
 await dispatch();expect((await listNotifications(f.ctx,b.id,{unread:true})).items).toHaveLength(0);expect(state.notify).toBe(false);
});
test("unverified private restore closes only new features and exposes aggregate status",async()=>{
 const a=await owner();await f.ctx.db.update(communityFollowingStatus).set({ready:false}).where(eq(communityFollowingStatus.id,"global"));
 try{await expect(listFollowing(f.ctx,a.id)).rejects.toMatchObject({status:503});expect((await followingStatus(f.ctx)).ready).toBe(false);expect((await listNotifications(f.ctx,a.id,{})).followingUnavailable).toBe(true);}finally{await f.ctx.db.update(communityFollowingStatus).set({ready:true}).where(eq(communityFollowingStatus.id,"global"));}
});
test("500-follow cap, reciprocal idempotency and account-bound stale cursors",async()=>{
 const a=await owner(),b=await owner();
 const both=await Promise.all([setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false}),setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false})]);expect(both[0]).toEqual(both[1]);
 const many=Array.from({length:500},()=>crypto.randomUUID());owners.push(...many);
 await f.ctx.db.insert(user).values(many.map(id=>({id,name:"Cap author",email:`${id}@placeholder.invalid`})));
 await f.ctx.exportChartJournal!();
 for(const id of many)await f.ctx.db.execute(sql`insert into community_follows(user_id,author_id,revision,followed_at,journal_sequence) values(${a.id},${id},1,clock_timestamp(),1)`);
 await expect(setFollow(f.ctx,a.id,b.number,{expectedRevision:0,following:true,notify:false})).rejects.toMatchObject({status:429});
 const page=await listFollowing(f.ctx,a.id);expect(page.items).toHaveLength(20);expect(page.nextCursor).toBeTruthy();
 await expect(listFollowing(f.ctx,b.id,page.nextCursor!)).rejects.toMatchObject({status:409});
 await setFollow(f.ctx,a.id,page.items[0]!.author.publicId,{expectedRevision:1,following:false,notify:false});
 await expect(listFollowing(f.ctx,a.id,page.nextCursor!)).rejects.toMatchObject({status:409});
},30000);
test("concurrent dispatch of one event has one durable delivery and one unread author group",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});const chart=await release(a.id);
 await Promise.all([dispatchFollowingUpdates(f.ctx),dispatchFollowingUpdates(f.ctx)]);
 const notices=await listNotifications(f.ctx,b.id,{kind:"author_update"});expect(notices.items).toHaveLength(1);
 const delivered=await f.ctx.db.execute(sql`select count(*)::int n from community_update_deliveries where event_id=${publicationEventId(chart.id,chart.currentVersionId!)}::uuid and user_id=${b.id}`);expect(delivered.rows[0]?.n).toBe(1);
});

async function replayPrivateTail() {
 const verified=await verifyLatestJournal(journal),c=new Client({connectionString:testDatabaseUrl()});await c.connect();
 try{for(const r of verified.records.filter(r=>r.kind==="private_social"))await replayFollowingFact(c,r);await finishFollowingReplay(c,verified.head.sequence);}finally{await c.end();}
}
test("recovery resumes an exported publication before its first delivery",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});await release(a.id);
 expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(0);
 await replayPrivateTail();await dispatch();expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(1);
 await dispatch();expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(1);
});
test("recovery restarts a partial 101-recipient batch without reviving a read notification",async()=>{
 const a=await owner(),followers=Array.from({length:101},()=>crypto.randomUUID()).sort();owners.push(...followers);
 await f.ctx.db.insert(user).values(followers.map(id=>({id,name:"Batch follower",email:`${id}@placeholder.invalid`})));
 const now=new Date().toISOString();
 await withStorageTransaction(f.ctx.db,async tx=>{for(const userId of followers){const fact={version:1 as const,entity:"follow" as const,id:crypto.randomUUID(),revision:1,userId,authorId:a.id,followedAt:now,notifySince:now,updatedAt:now};const sequence=await recordPrivateFact(tx,fact);await tx.execute(sql`insert into community_follows(id,user_id,author_id,revision,followed_at,notify_since,updated_at,journal_sequence) values(${fact.id}::uuid,${userId},${a.id},1,${now},${now},${now},${sequence})`);}});
 await f.ctx.exportChartJournal!();const chart=await release(a.id),event=publicationEventId(chart.id,chart.currentVersionId!);
 await dispatchFollowingUpdates(f.ctx);
 expect((await f.ctx.db.execute(sql`select count(*)::int n from community_update_deliveries where event_id=${event}::uuid`)).rows[0]?.n).toBe(100);
 const notice=(await listNotifications(f.ctx,followers[0]!,{})).items[0]!;await readNotifications(f.ctx,followers[0]!,[notice.id]);
 await replayPrivateTail();await dispatch();
 expect((await f.ctx.db.execute(sql`select count(*)::int n from community_update_deliveries where event_id=${event}::uuid`)).rows[0]?.n).toBe(101);
 expect((await listNotifications(f.ctx,followers[0]!,{unread:true})).items).toHaveLength(0);
 expect((await listNotifications(f.ctx,followers[100]!,{})).items).toHaveLength(1);
},30000);
test("legacy permission tail is backfilled quietly before an old version is republished",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});let chart=await release(a.id);
 const event=publicationEventId(chart.id,chart.currentVersionId!);
 // Model a pre-feature dump + verified permission tail: this version has no private publication fact.
 await f.ctx.db.execute(sql`delete from community_publication_events where id=${event}::uuid`);
 const verified=await verifyLatestJournal(journal),c=new Client({connectionString:testDatabaseUrl()});await c.connect();try{await finishFollowingReplay(c,verified.head.sequence);}finally{await c.end();}
 expect((await f.ctx.db.execute(sql`select notify,completed from community_publication_events where id=${event}::uuid`)).rows[0]).toEqual({notify:false,completed:true});
 expect((await listFeed(f.ctx,b.id)).items.map(i=>i.chart.id)).toContain(chart.id);
 chart=await updateChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,title:"Legacy metadata",artist:"Artist"});
 await publishChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,versionId:chart.currentVersionId!,confirmOriginalArchive:true});await dispatch();
 expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(0);
});
test("a pending permission export defers dispatch and preserves its recipient cursor",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});let chart=await release(a.id);
 chart=await updateChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,title:"Pending metadata",artist:"Artist"});
 const exporter=f.ctx.exportChartJournal;f.ctx.exportChartJournal=async()=>{};
 try{await expect(publishChart(f.ctx,a.id,chart.id,{expectedRevision:chart.revision,versionId:chart.currentVersionId!,confirmOriginalArchive:true})).rejects.toMatchObject({status:503});
 await expect(dispatchFollowingUpdates(f.ctx)).rejects.toMatchObject({status:503});
 const [event]=(await f.ctx.db.execute(sql`select completed,cursor from community_publication_events where chart_id=${chart.id}::uuid`)).rows;expect(event).toEqual({completed:false,cursor:null});
 expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(0);
 }finally{f.ctx.exportChartJournal=exporter;await exporter!();}
 await dispatch();expect((await listNotifications(f.ctx,b.id,{})).items).toHaveLength(1);
});

test("feed keyset pages remain private and decode native SQL timestamps",async()=>{
 const a=await owner(),b=await owner(),other=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:false});
 for(let i=0;i<21;i++)await release(a.id);
 const first=await listFeed(f.ctx,b.id);expect(first.items).toHaveLength(20);expect(first.nextCursor).toBeTruthy();
 const second=await listFeed(f.ctx,b.id,first.nextCursor!);expect(second.items).toHaveLength(1);expect(second.nextCursor).toBeNull();expect(new Set([...first.items,...second.items].map(i=>i.id)).size).toBe(21);
 await expect(listFeed(f.ctx,other.id,first.nextCursor!)).rejects.toMatchObject({status:409});
},30000);

test("deletion cannot report success before its account cutoff is exported",async()=>{
 const a=await owner(),b=await owner();await setFollow(f.ctx,b.id,a.number,{expectedRevision:0,following:true,notify:true});
 const exporter=f.ctx.exportChartJournal,deps={db:f.ctx.db,boss:f.ctx.boss,handlers:[followingDeletionHandler(f.ctx)]};f.ctx.exportChartJournal=async()=>{};
 try{await expect(requestDeletion(deps,a.id,{deleteContent:false})).rejects.toMatchObject({status:503});expect((await f.ctx.db.select().from(user).where(eq(user.id,a.id)))[0]?.status).toBe("pending_deletion");}
 finally{f.ctx.exportChartJournal=exporter;await exporter!();}
 await cancelDeletion(deps,a.id);expect((await getFollow(f.ctx,b.id,a.number)).following).toBe(false);
});
