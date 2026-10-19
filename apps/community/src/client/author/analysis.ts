import { parseSimaiChart, type ParseDiagnostic, type SimaiStatement } from "@lxns-network/maimai-chart-engine/parser";
import { TimingTimeline } from "@lxns-network/maimai-chart-engine/timing";
import type { ChartDifficulty } from "@/shared/charts";
import { normalizeChartMaidataWithMap } from "@/shared/charts-maidata";
export const ANALYSIS_VERSION = 1;
export type SourceStatement = { start: number; end: number; line: number; column: number; seconds: number; beat: number };
export type AnalysisDiagnostic = { code: string; line?: number; column?: number; offset?: number };
export type MaidataAnalysis = { algorithm: number; difficulty: ChartDifficulty; statements: SourceStatement[]; following: boolean;
 diagnostics: AnalysisDiagnostic[]; bpm: {timing:number;bpm:number}[]; firstMs:number; noteCount:number; error:string|null };
/** Derivation only; admission still uses the server's recorded import summary. */
export function analyzeMaidata(source: string, difficulty: ChartDifficulty): MaidataAnalysis {
 if (new TextEncoder().encode(source).length > 1048576) throw new Error("SOURCE_LIMIT");
 const normalized = normalizeChartMaidataWithMap(source);
 const starts=[0]; for(let i=0;i<source.length;i++) if(source[i]==="\r"||source[i]==="\n") {if(source[i]==="\r"&&source[i+1]==="\n")i++;starts.push(i+1);}
 const surrogateEnds:number[]=[];for(let i=1;i<source.length;i++)if(/[\uDC00-\uDFFF]/.test(source[i])&&/[\uD800-\uDBFF]/.test(source[i-1]))surrogateEnds.push(i+1);
 const pairsBefore=(offset:number)=>{let low=0,high=surrogateEnds.length;while(low<high){const mid=(low+high)>>>1;if(surrogateEnds[mid]<=offset)low=mid+1;else high=mid;}return low;};
 const location=(offset:number|undefined)=>{
  if(offset===undefined||offset<0)return undefined;
  let low=0,high=starts.length;while(low<high){const mid=(low+high)>>>1;if(starts[mid]<=offset)low=mid+1;else high=mid;}
  const index=low-1;let safe=offset;
  if(/[\uDC00-\uDFFF]/.test(source[safe]??"")&&/[\uD800-\uDBFF]/.test(source[safe-1]??""))safe--;
  return {line:index+1,column:safe-starts[index]-(pairsBefore(safe)-pairsBefore(starts[index]))+1,offset:safe};
 };
 const points:SimaiStatement[]=[], warnings:ParseDiagnostic[]=[];let following=true;
 const base:MaidataAnalysis={algorithm:ANALYSIS_VERSION,difficulty,statements:[],following:true,diagnostics:[],bpm:[],firstMs:0,noteCount:0,error:null};
 try {
  const chart=parseSimaiChart(normalized.text,difficulty,{maxNotes:100000,maxDurationMs:3600000,onDiagnostic:d=>warnings.push(d),onStatement:s=>{if(points.length<50000)points.push(s);else following=false;}});
  const timeline=TimingTimeline.fromChart(chart);
  for(const point of points){
   if(point.sourceStart===undefined||point.sourceEnd===undefined||point.sourceEnd<point.sourceStart)continue;
   const start=normalized.offsets[point.sourceStart],delimiter=normalized.text[point.sourceEnd]===",",last=normalized.offsets[delimiter?point.sourceEnd:point.sourceEnd-1],position=location(start);
   if(!position||last<start)continue;
   base.statements.push({start,end:last+1,line:position.line,column:position.column,seconds:timeline.msFromBeat(point.beat)/1000,beat:point.beat});
  }
  base.bpm=chart.bpmEvents??[];base.firstMs=chart.firstMs??0;base.noteCount=chart.notes.length;base.following=following;
 } catch(error){base.error=error instanceof Error&&error.name==="ParseLimitError"?"CHART_COMPLEXITY_EXCEEDED":"PREVIEW_UNSUPPORTED";base.statements=[];base.following=false;}
 base.diagnostics=warnings.map(d=>{const position=location(d.sourceStart===undefined?undefined:normalized.offsets[d.sourceStart]);return {code:d.code,...position};});
 return base;
}
