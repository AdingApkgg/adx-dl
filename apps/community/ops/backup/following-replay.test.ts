import { beforeAll,expect,test } from "bun:test";
import { Client } from "pg";
import { eq,sql } from "drizzle-orm";
import { resetTestDatabase,testDbHandle } from "../../src/server/testing/test-db";
import { testDatabaseUrl } from "../../src/server/testing/services";
import { user,communityFollowingStatus } from "../../src/server/db/schema";
import { replayFollowingFact,finishFollowingReplay } from "./following-replay";
import type { JournalRecord } from "./journal";
beforeAll(resetTestDatabase);
const at=(n:number)=>new Date(Date.UTC(2026,9,19,0,0,n)).toISOString();
test("an older unread group cannot displace a newer group in the restored snapshot",async()=>{
 const {db}=testDbHandle(),viewer=crypto.randomUUID(),author=crypto.randomUUID();await db.insert(user).values([viewer,author].map(id=>({id,name:"Replay",email:`${id}@placeholder.invalid`})));
 const newer=crypto.randomUUID(),older=crypto.randomUUID();
 await db.execute(sql`insert into community_update_notifications(id,user_id,author_id,event_id,event_at,created_at,read_at,revision,journal_sequence) values(${newer}::uuid,${viewer},${author},${crypto.randomUUID()}::uuid,${at(20)}::timestamptz,${at(20)}::timestamptz,null,1,20)`);
 const fact={version:1,entity:"notification",id:older,revision:1,userId:viewer,authorId:author,eventId:crypto.randomUUID(),eventAt:at(10),createdAt:at(10),readAt:null};
 const record={sequence:10,kind:"private_social",payload:fact,userId:null,fileId:null,sha256:null,generation:null,createdAt:at(10)} as JournalRecord;
 const c=new Client({connectionString:testDatabaseUrl()});await c.connect();try{await replayFollowingFact(c,record);}finally{await c.end();}
 const result=await db.execute(sql`select id from community_update_notifications where user_id=${viewer} and read_at is null`);expect(result.rows.map(r=>r.id)).toEqual([newer]);
 await db.delete(user).where(eq(user.id,viewer));await db.delete(user).where(eq(user.id,author));
});
test("an unexported private projection closes only following after recovery",async()=>{
 const {db}=testDbHandle(),id=crypto.randomUUID();
 await db.execute(sql`insert into community_following_accounts(user_id,revision,cutoff_at,journal_sequence) values(${id},1,clock_timestamp(),999999999)`);
 const c=new Client({connectionString:testDatabaseUrl()});await c.connect();try{await finishFollowingReplay(c,0);}finally{await c.end();}
 expect((await db.select().from(communityFollowingStatus))[0]?.ready).toBe(false);
 await db.execute(sql`delete from community_following_accounts where user_id=${id}`);await db.update(communityFollowingStatus).set({ready:true});
});
