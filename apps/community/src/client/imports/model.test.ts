import {expect,test} from "bun:test";
import {validatePlan,restorePlan,IMPORT_BYTES,IMPORT_TTL,type ImportRow} from "./model";
const row=(id:string,more:Partial<ImportRow>={}):ImportRow=>({id:crypto.randomUUID(),name:id+".zip",size:10,rawSize:10,createdAt:Date.now(),expiresAt:Date.now()+IMPORT_TTL,phase:"confirmation",progress:0,target:null,...more});
test("batch planning rejects ten-plus rows, byte overflow, duplicate bytes and duplicate explicit targets",()=>{
 expect(()=>validatePlan(Array.from({length:11},(_,i)=>row(String(i))))).toThrow("BATCH_LIMIT");
 expect(()=>validatePlan([row("a",{rawSize:IMPORT_BYTES}),row("b")])).toThrow("BATCH_LIMIT");
 expect(()=>validatePlan([row("a",{hash:"a".repeat(64)}),row("b",{hash:"a".repeat(64)})])).toThrow("DUPLICATE_BYTES");
 expect(()=>validatePlan([row("a",{target:{id:"c",revision:1}}),row("b",{target:{id:"c",revision:1}})])).toThrow("DUPLICATE_TARGET");
 expect(()=>validatePlan([row("same",{hash:"a".repeat(64)}),row("same2",{hash:"b".repeat(64)})])).not.toThrow();
});
test("refresh never queues, uploads or saves; even saved results need server reconciliation",()=>{
 const saved=restorePlan([row("a",{phase:"saved",fileId:crypto.randomUUID(),result:{chartId:crypto.randomUUID(),versionId:crypto.randomUUID()}})]);
 expect(saved[0].phase).toBe("uncertain");
 expect(restorePlan([row("b",{phase:"uploading"})])[0].phase).toBe("paused");
 expect(restorePlan([row("expired",{expiresAt:Date.now()-1})])).toEqual([]);
});
