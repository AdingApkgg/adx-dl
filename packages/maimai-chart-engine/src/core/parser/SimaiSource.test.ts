import { expect, test } from "bun:test";
import { parseSimaiChart, type SimaiStatement } from "./SimaiParser";
import { TimingTimeline } from "../timing/TimingTimeline";
test("optional statement spans point at selected difficulty and reuse lead-adjusted central timing", () => {
  const source = "&first=0.5\n&inote_3=(100)8,E\n&inote_4=(120){4}1,(240)2,3,E";
  const statements: SimaiStatement[] = [];
  const chart = parseSimaiChart(source, 4, { onStatement: s => statements.push(s) });
  expect(chart).toEqual(parseSimaiChart(source, 4));
  expect(statements[0].sourceStart).toBe(source.indexOf("(120)"));
  expect(source.slice(statements[1].sourceStart!, statements[1].sourceEnd!)).toBe("(240)2");
  const timeline = TimingTimeline.fromChart(chart);
  expect(statements.map(s => timeline.msFromBeat(s.beat))).toEqual([2000, 2500, 2750, 3000]);
  expect(statements[0].difficulty).toBe(4);
});
test("empty header line and body-relative diagnostics receive full source offsets", () => {
  const source = "&title=T\n&inote_4=\n(120)1,\nwrong,E";
  const warnings: {sourceStart?:number}[] = [];
  parseSimaiChart(source, 4, { onDiagnostic: d => warnings.push(d) });
  expect(warnings.some(d => d.sourceStart === source.indexOf("wrong"))).toBe(true);
});

test("same-line diagnostics carry their actual statement offset rather than the first note on that line",()=>{
 const source="&inote_4=(120)1,wrong,2,E",warnings:{code:string;sourceStart?:number}[]=[];
 parseSimaiChart(source,4,{onDiagnostic:d=>warnings.push(d)});
 expect(warnings.find(d=>d.code==="UNKNOWN_TOKEN")?.sourceStart).toBe(source.indexOf("wrong"));
});
