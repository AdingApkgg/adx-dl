import {expect,test} from "bun:test";
import {permissionFact,retentionFact} from "../../src/shared/chart-journal";
import {preservePayloadShape,journalBatchPrefix} from "./journal-codec";
const old={version:1 as const,chartId:"00000000-0000-4000-8000-000000000001",revision:1,publication:{versionId:"00000000-0000-4000-8000-000000000002",title:"Old",artist:"",publishedAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-01T00:00:00.000Z"}};
test("legacy exported bytes survive replay defaults, including retained publications",()=>{
 const parsed=permissionFact.parse(old);expect(parsed.publication?.description).toBe("");
 expect(JSON.stringify(preservePayloadShape(parsed,old))).toBe(JSON.stringify(old));
 const retained={version:1,retained:[old]};expect(JSON.stringify(preservePayloadShape(retentionFact.parse(retained),retained))).toBe(JSON.stringify(retained));
 const current={...old,publication:{...old.publication,description:"Published",credits:"",releaseNote:"",tags:[]}};
 expect(preservePayloadShape(permissionFact.parse(current),current).publication?.description).toBe("Published");
});
test("a metadata backlog larger than a segment drains instead of failing forever",()=>{
 const records=Array.from({length:1000},(_,sequence)=>({sequence,payload:"🎵".repeat(4000)}));
 const batch=journalBatchPrefix(records);expect(batch.length).toBeGreaterThan(0);expect(batch.length).toBeLessThan(records.length);
 expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(8*1024*1024);
 expect(journalBatchPrefix(records.slice(batch.length)).length).toBeGreaterThan(0);
 expect(()=>journalBatchPrefix([{body:"x".repeat(100)}],32)).toThrow("STORAGE_JOURNAL_RECORD_TOO_LARGE");
});
