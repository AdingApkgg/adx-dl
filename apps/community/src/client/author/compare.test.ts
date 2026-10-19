import {expect,test} from "bun:test";
import {compareStatements,compareFingerprints} from "./compare";
const tokens=(values:string[])=>values.map((text,index)=>({text,start:index,end:index+1}));
test("bounded diff retains stable anchors and reports complete insert/delete ranges",()=>{
 const result=compareStatements(tokens(["1","2","3"]),tokens(["1","4","3","5"]));
 expect(result.complete).toBe(true);expect(result.hunks).toEqual([{leftStart:1,leftEnd:2,rightStart:1,rightEnd:2},{leftStart:3,leftEnd:3,rightStart:3,rightEnd:4}]);
});
test("unit, hunk and time budgets fall back honestly instead of silently truncating",()=>{
 expect(compareStatements(tokens(Array(20001).fill("x")),[]).complete).toBe(false);
 expect(compareStatements(tokens(["a","b"]),tokens(["b","a"]),{maxHunks:0}).complete).toBe(false);
 let clock=0;expect(compareStatements(tokens(["a"]),tokens(["b"]),{now:()=>clock+=6000}).complete).toBe(false);
});
test("different archive bytes with identical role hashes is not whole-package equivalence",()=>{
 const asset={sha256:"c".repeat(64),size:4,mime:"text/plain"};
 const left={versionId:"l",source:{sha256:"a".repeat(64),size:10},assets:{maidata:asset}};
 const result=compareFingerprints(left,{...left,versionId:"r",source:{sha256:"b".repeat(64),size:10}});
 expect(result).toMatchObject({archiveSame:false,previewSame:true});
});
