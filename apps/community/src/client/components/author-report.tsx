import {Button} from "@astrodx/ui/components/button";
import {m} from "@/paraglide/messages.js";
import type {ChartVersionDto} from "@/shared/charts";
import type {MaidataAnalysis} from "../author/analysis";
import {ChartSummary} from "./chart-summary";
export function AuthorReport({version,analysis,onSeek,onLocate}:{version:ChartVersionDto;analysis?:MaidataAnalysis;onSeek?:(seconds:number)=>void;onLocate?:(line:number)=>void}){
 return <section className="community-panel space-y-4"><h2 className="community-section-title">{m.author_review()} · {m.chart_version({number:String(version.ordinal)})}</h2><p className="text-sm">{m.author_advisory()}</p><ChartSummary summary={version.summary}/>
 {analysis?<><p>{analysis.error?m.chart_metadata_unknown():m.chart_notes({count:String(analysis.noteCount)})} · {m.ui_analysis_timing({count:String(analysis.bpm.length),time:String(analysis.firstMs)})}</p>{analysis.error?<p role="status">{m.author_analysis_failed()}</p>:null}{!analysis.error&&!analysis.diagnostics.length?<p className="text-sm text-muted-foreground">{m.ui_analysis_clear()}</p>:null}<ul className="space-y-2">{analysis.diagnostics.map((diagnostic,i)=>{const point=diagnostic.offset===undefined?undefined:analysis.statements.find(s=>s.line===diagnostic.line&&s.start>=diagnostic.offset!);return <li key={`${diagnostic.code}/${i}`} className="flex flex-wrap items-center gap-2"><code>{diagnostic.code}</code>{diagnostic.line?(onLocate?<Button variant="outline" onClick={()=>onLocate(diagnostic.line!)}>{m.author_source()} · {diagnostic.line}:{diagnostic.column}</Button>:<span>{diagnostic.line}:{diagnostic.column}</span>):null}{point&&onSeek&&!analysis.error?<Button variant="outline" onClick={()=>onSeek(point.seconds)}>{point.seconds.toFixed(3)}s</Button>:<span className="text-xs text-muted-foreground">{m.author_no_jump()}</span>}</li>;})}</ul></>:null}
 </section>;
}
