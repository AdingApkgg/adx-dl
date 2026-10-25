import {Button} from "@astrodx/ui/components/button";
import {useEffect,useMemo,useRef,useState} from "react";
import {m} from "@/paraglide/messages.js";
import type {MaidataAnalysis} from "../author/analysis";
const ROW=32,VISIBLE=12;
function activePoint(points:MaidataAnalysis["statements"],position:number){let low=0,high=points.length;while(low<high){const mid=(low+high)>>>1;if(points[mid].seconds<=position)low=mid+1;else high=mid;}return low-1;}
/** At most12 rows mounted; full original text remains available even without timing points. */
export function SimaiSource({source,analysis,position,onSeek,seekLimit=Infinity,focusLine}:{source:string;analysis:MaidataAnalysis;position:number;onSeek?:(seconds:number)=>void;seekLimit?:number;focusLine?:{line:number;token:number}|null}){
 const points=analysis.statements,available=analysis.following&&!analysis.error&&points.length>0;
 const [view,setView]=useState<"statements"|"source">(available?"statements":"source"),[following,setFollowing]=useState(available),[top,setTop]=useState(0),[search,setSearch]=useState("");
 const viewport=useRef<HTMLDivElement>(null),lines=useMemo(()=>source.length?source.split(/\r\n|\r|\n/):[],[source]);
 const count=view==="statements"?points.length:lines.length,height=Math.max(VISIBLE*ROW,Math.min(8000000,count*ROW)),maxScroll=Math.max(0,height-VISIBLE*ROW),lastStart=Math.max(0,count-VISIBLE);
 const first=maxScroll?Math.min(lastStart,Math.floor(top/maxScroll*lastStart)):0,current=activePoint(points,position);
 const searchResult=useMemo(()=>{if(!search)return {matches:[] as {line:number;offset:number}[],limited:false};const matches:{line:number;offset:number}[]=[];let at=0,line=0,offset=0;
  while(at<source.length){const hit=source.indexOf(search,at);if(hit<0)break;while(offset<hit){if(source[offset]==="\r"){line++;if(source[offset+1]==="\n")offset++;}else if(source[offset]==="\n")line++;offset++;}if(matches.length===200)return {matches,limited:true};matches.push({line,offset:hit});at=hit+Math.max(1,search.length);}return {matches,limited:false};
 },[source,search]);
 function scrollTo(index:number){const logical=Math.max(0,Math.min(lastStart,index)),next=lastStart?logical/lastStart*maxScroll:0;if(viewport.current)viewport.current.scrollTop=next;setTop(next);}
 // biome-ignore lint/correctness/useExhaustiveDependencies: scrollTo closes over measured virtual geometry; each listed input changes that geometry or the target.
 useEffect(()=>{if(available&&following&&view==="statements"&&current>=0)scrollTo(Math.max(0,current-3));},[available,following,view,current,source]);
 useEffect(()=>{setView(available?"statements":"source");setFollowing(available);setSearch("");setTop(0);if(viewport.current)viewport.current.scrollTop=0;},[source,analysis.difficulty,available]);
 useEffect(()=>{if(!focusLine)return;setFollowing(false);setView("source");const last=Math.max(0,lines.length-VISIBLE),fullHeight=Math.max(VISIBLE*ROW,Math.min(8000000,lines.length*ROW)),next=last?Math.min(last,Math.max(0,focusLine.line-1))/last*(fullHeight-VISIBLE*ROW):0;setTop(next);if(viewport.current)viewport.current.scrollTop=next;},[focusLine,lines.length]);
 return <section aria-label={m.author_source()} className="community-panel min-w-0 space-y-4"><h2 className="font-semibold">{m.author_source()}</h2>
 {!available?<p className="text-sm">{analysis.error?m.author_analysis_failed():m.author_source_limit()}</p>:null}
 <div className="flex flex-wrap gap-2"><Button variant={view==="source"?"default":"outline"} aria-pressed={view==="source"} onClick={()=>{setFollowing(false);setView("source");setTop(0);if(viewport.current)viewport.current.scrollTop=0;}}>{m.author_source()}</Button><Button disabled={!available} variant={view==="statements"?"default":"outline"} aria-pressed={view==="statements"} onClick={()=>{setView("statements");setTop(0);if(viewport.current)viewport.current.scrollTop=0;}}>{m.author_review()}</Button><Button variant="outline" disabled={!available} aria-pressed={following&&view==="statements"} onClick={()=>{setView("statements");setFollowing(true);scrollTo(Math.max(0,current-3));}}>{m.author_follow()}</Button></div>
 <label className="grid gap-2 text-sm">{m.author_search()}<input type="search" maxLength={200} value={search} onChange={e=>setSearch(e.target.value)} className="min-h-11 w-full rounded border bg-background p-2"/></label>
 {search?<div><p role="status" className="text-sm text-muted-foreground">{searchResult.matches.length?m.ui_source_results({count:String(searchResult.matches.length)+(searchResult.limited?"+":"")}):m.ui_source_no_match()}</p><div className="flex max-h-24 flex-wrap gap-2 overflow-auto">{searchResult.matches.map((match,i)=><button key={match.offset} type="button" className="min-h-11 underline" onClick={()=>{setFollowing(false);setView("source");const last=Math.max(0,lines.length-VISIBLE),fullHeight=Math.max(VISIBLE*ROW,Math.min(8000000,lines.length*ROW)),next=last?Math.min(last,match.line)/last*(fullHeight-VISIBLE*ROW):0;setTop(next);if(viewport.current)viewport.current.scrollTop=next;}}>{i+1} · {match.line+1}</button>)}</div></div>:null}
 {/* biome-ignore lint/a11y/noNoninteractiveTabindex: A focusable source region provides native keyboard scrolling alongside real seek buttons. */}
 <div ref={viewport} data-testid="source-viewport" role="region" aria-label={m.author_source()} tabIndex={0} onWheel={()=>setFollowing(false)} onTouchStart={()=>setFollowing(false)} onPointerDown={()=>setFollowing(false)} onKeyDown={e=>{if(["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"].includes(e.key))setFollowing(false);}} onScroll={e=>setTop(e.currentTarget.scrollTop)} className="relative overflow-auto rounded border bg-muted/30" style={{height:VISIBLE*ROW}}>
 <div style={{height,position:"relative",minWidth:"100%"}}><div style={{position:"absolute",top, left:0,right:0}}>{Array.from({length:Math.min(VISIBLE,count-first)},(_,i)=>{const index=first+i,point=view==="statements"?points[index]:undefined;
  const label=point?`${point.line}:${point.column} · ${point.seconds.toFixed(3)}s`:String(index+1),text=point?source.slice(point.start,point.end):lines[index];
  return <div key={`${view}-${index}`} style={{height:ROW}} className={`flex min-w-0 items-center font-mono text-xs ${view==="statements"&&index===current?"bg-primary/15":""}`}>
   {point&&onSeek?<button type="button" data-source-seek="" disabled={point.seconds>seekLimit} title={point.seconds>seekLimit?m.author_no_jump():undefined} aria-label={label} aria-current={index===current?"true":undefined} className="h-full shrink-0 border-r px-2 underline" onClick={()=>{setFollowing(false);onSeek(point.seconds);}}>{label}</button>:<span className="shrink-0 border-r px-2">{label}</span>}<pre className="m-0 overflow-x-auto whitespace-pre px-2">{text||" "}</pre>
  </div>;
 })}</div></div></div>
 {!following&&available?<p className="text-xs text-muted-foreground">{m.author_follow_paused()}</p>:null}
 <div className="community-toolbar"><Button variant="outline" disabled={first===0} onClick={()=>{setFollowing(false);scrollTo(first-VISIBLE);}}>{m.chart_previous()}</Button><Button variant="outline" disabled={first>=lastStart} onClick={()=>{setFollowing(false);scrollTo(first+VISIBLE);}}>{m.chart_next()}</Button><span className="text-xs text-muted-foreground">{m.ui_source_range({from:String(count?first+1:0),to:String(Math.min(count,first+VISIBLE)),total:String(count)})}</span></div>
 </section>;
}
