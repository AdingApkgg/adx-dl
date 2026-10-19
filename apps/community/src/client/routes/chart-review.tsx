import {Alert} from "@astrodx/ui/components/alert";
import {Button} from "@astrodx/ui/components/button";
import {HydrationBoundary,useQuery} from "@tanstack/react-query";
import {useState} from "react";
import {Link,useSearchParams} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import type {ChartDto} from "@/shared/charts";
import {loadAuthorChart} from "../author/load-chart";
import {reviewSelection} from "../author/route-selection";
import {useAuthorAnalysis} from "../author/use-analysis";
import {PageTitle,textLinkClass} from "../components/page-title";
import {AuthorReport} from "../components/author-report";
import {PrivateChartPreview} from "../components/private-chart-preview";
import {SimaiSource} from "../components/simai-source";
import {useImports} from "../imports/provider";
import {getRenderApi} from "../lib/browser";
import {chartErrorMessage} from "../lib/chart-errors";
import {authorChartQuery} from "../queries/charts";
import {meQuery} from "../queries/me";
import type {Route} from "./+types/chart-review";
export const loader=({context,url,params}:Route.LoaderArgs)=>loadAuthorChart(context,url,params.id,"review");
export function meta(){return [{title:`${m.author_review()} - ${m.site_name()}`},{name:"robots",content:"noindex"}];}
export default function Review({loaderData,params}:Route.ComponentProps){return <HydrationBoundary state={loaderData.dehydratedState}><OwnerReview actor={loaderData.actor} id={params.id}/></HydrationBoundary>;}
function OwnerReview({actor,id}:{actor:string;id:string}){const imports=useImports(),{data:me}=useQuery(meQuery(getRenderApi())),query=useQuery(authorChartQuery(getRenderApi(),actor,id));if(query.error)return <Alert variant="destructive">{chartErrorMessage(query.error)}</Alert>;if(!query.data||me?.id!==actor||imports&&imports.snapshot.scope!==actor)return null;return <ReviewContent chart={query.data} actor={actor}/>;}
function ReviewContent({chart,actor}:{chart:ChartDto;actor:string}){
 const [params,setParams]=useSearchParams(),{version,difficulty}=reviewSelection(chart,params),analysis=useAuthorAnalysis(actor,chart.id,[version.id],difficulty),[position,setPosition]=useState(0),[seek,setSeek]=useState<{token:number;seconds:number}|null>(null);
 const supported=version.summary.difficulties.find(d=>d.difficulty===difficulty)?.previewSupported??false,duration=(version.summary.difficulties.find(d=>d.difficulty===difficulty)?.durationMs??0)/1000;
 const onSeek=supported?(seconds:number)=>{if(seconds>=0&&seconds<=duration)setSeek({token:Date.now()+Math.random(),seconds});}:undefined;
 const choose=(name:string,value:string)=>{const next=new URLSearchParams(params);next.set(name,value);if(name==="version")next.delete("difficulty");setSeek(null);setPosition(0);setParams(next);};
 return <main className="space-y-6 pb-24"><PageTitle description={m.author_scope_hint()}>{m.author_review()} · {chart.title}</PageTitle><nav className="flex flex-wrap gap-3"><Link className={textLinkClass} to={localizeHref("/me/workbench")}>{m.author_workbench()}</Link><Link className={textLinkClass} to={localizeHref(`/me/charts/${chart.id}`)}>{m.chart_detail()}</Link><Link className={textLinkClass} to={localizeHref(`/me/charts/${chart.id}/compare?right=${version.id}&difficulty=${difficulty}`)}>{m.author_compare()}</Link></nav>
 <div className="flex flex-wrap gap-3"><label>{m.author_version()}<select className="ml-2 min-h-11 max-w-full rounded border p-2" value={version.id} onChange={e=>choose("version",e.target.value)}>{chart.versions.map(v=><option key={v.id} value={v.id}>{m.chart_version({number:String(v.ordinal)})}</option>)}</select></label><label>{m.chart_difficulties()}<select className="ml-2 min-h-11 rounded border p-2" value={difficulty} onChange={e=>choose("difficulty",e.target.value)}>{version.summary.difficulties.map(d=><option key={d.difficulty} value={d.difficulty}>{d.difficulty} · {d.level??"—"}</option>)}</select></label></div>
 <AuthorReport version={version} analysis={analysis.data?.result.analyses[0]} onSeek={onSeek}/>
 {analysis.error?<Alert variant="destructive">{chartErrorMessage(analysis.error)}<Button variant="outline" onClick={analysis.retry}>{m.author_retry()}</Button></Alert>:!analysis.data?<p role="status">{m.author_analysis_loading()}</p>:null}
 {analysis.data?<><section className="space-y-2 rounded border p-3"><h2>{m.author_package()}</h2><p className="break-all font-mono text-xs">SHA256 {analysis.data.fingerprints[0].source.sha256} · {analysis.data.fingerprints[0].source.size} B</p></section><SimaiSource key={`${version.id}/${difficulty}`} source={analysis.data.sources[0]} analysis={analysis.data.result.analyses[0]} position={position} onSeek={onSeek}/></>:null}
 {supported?<PrivateChartPreview key={`${version.id}/${difficulty}`} id={chart.id} versionId={version.id} summary={version.summary} controlledDifficulty={difficulty} externalSeek={seek} onPosition={setPosition}/>:<p>{m.author_analysis_failed()}</p>}
 </main>;
}
