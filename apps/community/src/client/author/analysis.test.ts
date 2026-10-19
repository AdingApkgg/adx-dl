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


test("author analysis shares Majdata short Hold and local-BPM timing with admission and preview", () => {
 const result=analyzeMaidata("&inote_6=(200){4}8bh/2bh,4bh,5bh,Ch,1h[150#2:1],E",6);
 expect(result.error).toBeNull();expect(result.diagnostics).toEqual([]);expect(result.noteCount).toBe(12);
 expect(result.statements[1].seconds).toBeCloseTo(1.5);
});
