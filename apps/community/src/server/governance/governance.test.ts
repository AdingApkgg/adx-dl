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
async function decision(recipient:string,actor:string){const id=crypto.randomUUID();await f.ctx.db.execute(sql`insert into discussion_decisions(id,actor_id,recipient_id,entity,entity_id,action,reason,public_reason) values(${id}::uuid,${actor},${recipient},'message',${crypto.randomUUID()},'hide','Internal secret','Public explanation')`);return `decision:${id}`;}
beforeAll(async()=>{await resetTestDatabase();f=await readyContext();});
afterAll(async()=>{if(f)await cleanupStorageFixture(f.ctx.db,owners,[f.policy.id]);});
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
 const reporter=await owner(),id=crypto.randomUUID(),chart=crypto.randomUUID(),at="2026-10-20T00:00:00.123456Z";
 await f.ctx.db.execute(sql`insert into chart_reports(id,reporter_id,chart_id,public_id,version_id,title,artist,category,details,created_at) values(${id}::uuid,${reporter},${chart}::uuid,987,${crypto.randomUUID()}::uuid,'Public','Artist','other','Private evidence',${at}::timestamptz)`);
 await f.ctx.db.execute(sql`insert into discussion_reports(id,reporter_id,target_type,target_id,category,details,evidence_expires_at,created_at) values(${id}::uuid,${reporter},'forum_reply',${crypto.randomUUID()}::uuid,'other','Private evidence',clock_timestamp(),${at}::timestamptz)`);
 const page=await governanceTickets(f.ctx,{status:"all"});
 const matching=page.items.filter(x=>x.id===id);expect(matching).toHaveLength(2);
 expect(new Set(matching.map(x=>x.source)).size).toBe(2);expect(JSON.stringify(page)).not.toContain("Private evidence");
});
