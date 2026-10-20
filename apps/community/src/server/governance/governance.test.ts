import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeJournal, exportJournal } from "../../../ops/backup/journal";
import { testDatabaseUrl } from "../testing/services";
import { prepareTestQueues } from "../testing/test-boss";
import { recordCommunityFact } from "../community/content-journal";
import { withSocialUser } from "../services/social-page";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { resetTestDatabase } from "../testing/test-db";
import { readyContext, readyOwner } from "../../../test/storage/ready-file";
import { cleanupStorageFixture } from "../../../test/storage/fixture";
import { createAppeal, resolveAppeal, listAppeals, governanceDecisions } from "./appeals";
import { governanceTickets, governanceAudit, governanceOverview } from "./core";
import { dispatchDiscussionOutbox, listNotifications } from "../discussions/notifications";
let f: Awaited<ReturnType<typeof readyContext>>;
const owners:string[]=[];
async function owner(){const id=await readyOwner(f.ctx);owners.push(id);return id;}
async function decision(recipient:string,actor:string){const id=crypto.randomUUID(),target=crypto.randomUUID();await withSocialUser(f.ctx.db,actor,async tx=>{await recordCommunityFact(tx,{version:1,entity:"message",id:target,revision:1,state:"hidden"},actor);await tx.execute(sql`insert into discussion_decisions(id,actor_id,recipient_id,entity,entity_id,action,reason,public_reason) values(${id}::uuid,${actor},${recipient},'message',${target},'hide','Internal secret','Public explanation')`);});await f.ctx.exportChartJournal!();return `decision:${id}`;}
let journalDir:string;
beforeAll(async()=>{await resetTestDatabase();await prepareTestQueues();f=await readyContext();journalDir=await mkdtemp(join(tmpdir(),"governance-journal-"));const keyFile=join(journalDir,'key');await writeFile(keyFile,crypto.getRandomValues(new Uint8Array(32)),{mode:0o600});const config={directory:join(journalDir,'log'),keyFile,databaseUrl:testDatabaseUrl()};await f.ctx.db.execute(sql`update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'`);await initializeJournal(config);f.ctx.exportChartJournal=async()=>{await exportJournal(config);};},30000);
afterAll(async()=>{if(f)await cleanupStorageFixture(f.ctx.db,owners,[f.policy.id]);if(journalDir)await rm(journalDir,{recursive:true,force:true});});
test("only recipient can appeal; retries keep first text, concurrent submissions create one row",async()=>{
 const author=await owner(),staff=await owner(),other=await owner(),key=await decision(author,staff);
 await expect(createAppeal(f.ctx,other,{decisionKey:key,reason:"foreign"})).rejects.toMatchObject({status:404});
 const results=await Promise.all([createAppeal(f.ctx,author,{decisionKey:key,reason:"First"}),createAppeal(f.ctx,author,{decisionKey:key,reason:"First"})]);
 expect(results[0].id).toBe(results[1].id);
 expect((await createAppeal(f.ctx,author,{decisionKey:key,reason:"Retry text"})).reason).toBe("First");
 expect((await listAppeals(f.ctx,{},other)).items).toHaveLength(0);
 const decisions=await governanceDecisions(f.ctx,author,{});
 expect(decisions.items.find(x=>x.key===key)?.publicReason).toBe("Public explanation");
 expect(JSON.stringify(decisions)).not.toContain("Internal secret");
});
test("review is revision guarded, notified once, never unhides content, and audits transactionally",async()=>{
 const author=await owner(),staff=await owner(),key=await decision(author,staff);
 const appeal=await createAppeal(f.ctx,author,{decisionKey:key,reason:"Please recheck"});
 const input={expectedRevision:1,status:"review_required" as const,note:"Needs a fresh review"};
 const result=await resolveAppeal(f.ctx,staff,appeal.id,input);
 expect(result.status).toBe("review_required");expect(result.revision).toBe(2);
 expect((await resolveAppeal(f.ctx,staff,appeal.id,input)).id).toBe(appeal.id);
 await expect(resolveAppeal(f.ctx,staff,appeal.id,{...input,status:"upheld"})).rejects.toMatchObject({status:409});
 await dispatchDiscussionOutbox(f.ctx);await dispatchDiscussionOutbox(f.ctx);
 const notices=(await listNotifications(f.ctx,author,{})).items.filter(x=>x.href==="/me/governance");
 expect(notices).toHaveLength(1);expect(notices[0]?.publicReason).toBe(input.note);
 const audit=await governanceAudit(f.ctx,{kind:"appeal_resolution"});
 expect(audit.items.filter(x=>x.targetId===appeal.id)).toHaveLength(1);
 expect(JSON.stringify(audit)).not.toContain(appeal.reason);
 const before=await governanceOverview(f.ctx);
 try{await f.ctx.db.transaction(async tx=>{await tx.execute(sql`insert into discussion_decisions(actor_id,recipient_id,entity,entity_id,action,reason,public_reason) values(${staff},${author},'message','rolledback','hide','secret','public')`);throw new Error("rollback");});}catch{}
 expect((await governanceOverview(f.ctx)).actions24h).toBe(before.actions24h);
});
test("appeals enforce user-wide caps while exact recovery remains available",async()=>{
 const author=await owner(),staff=await owner();
 let first="";for(let i=0;i<5;i++){const key=await decision(author,staff);if(i===0)first=key;await createAppeal(f.ctx,author,{decisionKey:key,reason:"Reason"});}
 await expect(createAppeal(f.ctx,author,{decisionKey:await decision(author,staff),reason:"Sixth"})).rejects.toMatchObject({status:429});
 expect((await createAppeal(f.ctx,author,{decisionKey:first,reason:"Retry"})).reason).toBe("Reason");
});
test("unified report cursor keeps all sources when timestamps and UUIDs coincide",async()=>{
 const reporter=await owner(),id=crypto.randomUUID(),chart=crypto.randomUUID(),at="2099-10-20T00:00:00.123456Z";
 await f.ctx.db.execute(sql`insert into chart_reports(id,reporter_id,chart_id,public_id,version_id,title,artist,category,details,created_at) values(${id}::uuid,${reporter},${chart}::uuid,987,${crypto.randomUUID()}::uuid,'Public','Artist','other','Private evidence',${at}::timestamptz)`);
 await f.ctx.db.execute(sql`insert into discussion_reports(id,reporter_id,target_type,target_id,category,details,evidence_expires_at,created_at) values(${id}::uuid,${reporter},'forum_reply',${crypto.randomUUID()}::uuid,'other','Private evidence',clock_timestamp(),${at}::timestamptz)`);
 await f.ctx.db.execute(sql`insert into chart_list_reports(id,list_id,reporter_id,category,details,created_at) values(${id}::uuid,${crypto.randomUUID()}::uuid,${reporter},'other','Private evidence',${at}::timestamptz)`);
 const ids:string[]=[id];for(let i=0;i<24;i++){const next=crypto.randomUUID();ids.push(next);await f.ctx.db.execute(sql`insert into chart_reports(id,reporter_id,chart_id,public_id,version_id,title,artist,category,details,created_at) values(${next}::uuid,${reporter},${crypto.randomUUID()}::uuid,987,${crypto.randomUUID()}::uuid,'Public','Artist','other','Private evidence',${at}::timestamptz)`);}
 const first=await governanceTickets(f.ctx,{status:"all"});expect(first.items).toHaveLength(20);expect(first.nextCursor).not.toBeNull();
 const second=await governanceTickets(f.ctx,{status:"all",cursor:first.nextCursor!});
 const page={items:[...first.items,...second.items]};
 expect(new Set(page.items.map(x=>`${x.source}/${x.id}`)).size).toBe(page.items.length);
 expect(page.items.filter(x=>ids.includes(x.id))).toHaveLength(27);
 await expect(governanceTickets(f.ctx,{status:'open',cursor:first.nextCursor!})).rejects.toMatchObject({status:400});
 const matching=page.items.filter(x=>x.id===id);expect(matching).toHaveLength(3);
 expect(new Set(matching.map(x=>x.source)).size).toBe(3);expect(JSON.stringify(page)).not.toContain("Private evidence");
});

test("missing or undurable decision cannot create an appeal; deleting account removes private reason",async()=>{
 const author=await owner(),staff=await owner(),target=crypto.randomUUID(),id=crypto.randomUUID();
 await expect(createAppeal(f.ctx,author,{decisionKey:`decision:${crypto.randomUUID()}`,reason:'No decision'})).rejects.toMatchObject({status:404});
 await f.ctx.db.execute(sql`insert into discussion_decisions(id,actor_id,recipient_id,entity,entity_id,action,reason,public_reason) values(${id}::uuid,${staff},${author},'message',${target},'hide','Internal','Public')`);
 await expect(createAppeal(f.ctx,author,{decisionKey:`decision:${id}`,reason:'No durable fact'})).rejects.toMatchObject({status:404});
 const key=await decision(author,staff),saved=await createAppeal(f.ctx,author,{decisionKey:key,reason:'Delete my private text'});
 await resolveAppeal(f.ctx,staff,saved.id,{expectedRevision:1,status:'upheld',note:'Delete my private feedback'});
 await f.ctx.db.execute(sql`delete from "user" where id=${author}`);
 expect((await f.ctx.db.execute(sql`select id from governance_appeals where id=${saved.id}::uuid`)).rows).toHaveLength(0);
 expect((await f.ctx.db.execute(sql`select id from discussion_decisions where public_reason='Delete my private feedback' or reason='Delete my private feedback'`)).rows).toHaveLength(0);
});
