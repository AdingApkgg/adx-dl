import {expect,test} from "bun:test";
import {analyzeMaidata} from "./analysis";
test("analysis reports original positions and timeline seconds without absorbing first audio offset",()=>{
 const source="\uFEFF&first=0.5\r\n&INOTE_4=(120){4}1,(240)2,E";
 const result=analyzeMaidata(source,4);
 expect(result.error).toBeNull(); expect(result.statements[0]).toMatchObject({line:2,column:10,seconds:2});
 expect(result.statements[1].seconds).toBe(2.5);
 expect(result.firstMs).toBe(500);
});
test("empty and oversized source are bounded failures, never synthetic source jumps",()=>{
 expect(analyzeMaidata("",4).error).not.toBeNull();
 expect(()=>analyzeMaidata("x".repeat(1048577),4)).toThrow("SOURCE_LIMIT");
});
