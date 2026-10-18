import { expect, test } from "bun:test";
import { privateSocialFact } from "./private-social-journal";
import { validJournalRecord } from "../../ops/backup/journal";
const at="2026-10-19T00:00:00.000Z";
const follow=()=>({version:1,entity:"follow",id:crypto.randomUUID(),revision:1,userId:"private-owner",authorId:"private-author",followedAt:at,notifySince:null,updatedAt:at});
test("private relationship controls are strict, versioned and never public content facts",()=>{
 const fact=follow();expect(privateSocialFact.safeParse(fact).success).toBe(true);
 for(const change of [{version:2},{authorId:fact.userId},{notifySince:"2026-10-18T00:00:00.000Z"},{followedAt:null,notifySince:at},{name:"private name"},{entity:"community_content"}])expect(privateSocialFact.safeParse({...fact,...change}).success).toBe(false);
 const record={sequence:1,kind:"private_social",payload:fact,userId:null,fileId:null,sha256:null,generation:null,createdAt:at};
 expect(validJournalRecord(record as never)).toBe(true);
 expect(validJournalRecord({...record,kind:"community_content"} as never)).toBe(false);
 expect(validJournalRecord({...record,kind:"unknown_private_version"} as never)).toBe(false);
 expect(validJournalRecord({...record,userId:"unexpected"} as never)).toBe(false);
});
test("minimal account cutoffs and notification read facts contain no public text",()=>{
 expect(privateSocialFact.safeParse({version:1,entity:"account",id:"deleted-user",revision:2,cutoffAt:at}).success).toBe(true);
 const notice={version:1,entity:"notification",id:crypto.randomUUID(),revision:1,userId:"viewer",authorId:null,eventId:crypto.randomUUID(),eventAt:at,createdAt:at,readAt:at};
 expect(privateSocialFact.safeParse(notice).success).toBe(true);
 expect(privateSocialFact.safeParse({...notice,body:"never exported"}).success).toBe(false);
});
