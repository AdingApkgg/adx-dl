import { MotionSurface, MotionGroup } from "../components/motion-ui";
import {Alert} from "@astrodx/ui/components/alert";
import {Button} from "@astrodx/ui/components/button";
import {dehydrate,HydrationBoundary,useQuery} from "@tanstack/react-query";
import {useId,useState} from "react";
import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {queryClientContext} from "@/shared/router-context";
import {ImportReselect} from "../components/import-reselect";
import {PageTitle,textLinkClass} from "../components/page-title";
import {requireUser} from "../lib/require-user";
import {getRenderApi} from "../lib/browser";
import {chartErrorMessage} from "../lib/chart-errors";
import type {ChartParts} from "../lib/chart-input";
import {useImports} from "../imports/provider";
import type {ImportRow} from "../imports/model";
import {workbenchQuery} from "../queries/charts";
import {meQuery} from "../queries/me";
import type {Route} from "./+types/imports";
export async function loader({context,url}:Route.LoaderArgs){await requireUser(context,url);return {dehydratedState:dehydrate(context.get(queryClientContext))};}
export function meta(){return [{title:`${m.author_imports()} - ${m.site_name()}`},{name:"robots",content:"noindex"}];}
export default function Imports({loaderData}:Route.ComponentProps){return <HydrationBoundary state={loaderData.dehydratedState}><ImportPlan/></HydrationBoundary>;}
export function importPhaseLabel(phase:ImportRow["phase"]){const labels={confirmation:m.author_phase_confirmation,queued:m.author_phase_queued,packing:m.author_phase_packing,hashing:m.author_phase_hashing,uploading:m.author_phase_uploading,processing:m.author_phase_processing,ready:m.author_phase_ready,saving:m.author_phase_saving,saved:m.author_phase_saved,uncertain:m.author_phase_uncertain,paused:m.author_phase_paused,failed:m.author_phase_failed,cancelled:m.author_phase_cancelled};return labels[phase]();}
function ImportPlan(){
 const imports=useImports(),{data:me}=useQuery(meQuery(getRenderApi())),page=useQuery({...workbenchQuery(getRenderApi(),me?.id??""),enabled:me?.status==="active"});
 const [selected,setSelected]=useState<string[]>([]),[parts,setParts]=useState<ChartParts>({}),[error,setError]=useState<unknown>(),id=useId();
 if(!imports||!me||me.status!=="active"||imports.snapshot.scope!==me.id)return <main><PageTitle>{m.author_imports()}</PageTitle><p role="status">{m.author_analysis_loading()}</p></main>;
 const {store,snapshot}=imports,run=(fn:()=>Promise<unknown>)=>{setError(undefined);void fn().catch(error=>{if(!(error instanceof DOMException&&error.name==="AbortError"))setError(error);});},busy=snapshot.busy;
 const rows=snapshot.rows,chosen=rows.filter(r=>selected.includes(r.id)),allIds=rows.map(r=>r.id);
 const failure=error??page.error;
 return <main className="space-y-6 pb-24 [&_button]:h-auto [&_button]:max-w-full [&_button]:min-h-11 [&_button]:whitespace-normal"><PageTitle description={m.author_scope_hint()}>{m.author_imports()}</PageTitle>
 <nav className="flex flex-wrap gap-3"><Link className={textLinkClass} to={localizeHref("/me/workbench")}>{m.author_workbench()}</Link><Link className={textLinkClass} to={localizeHref("/me/charts/new")}>{m.chart_new()}</Link></nav>
 <p>{m.author_plan_hint()}</p><p className="text-sm text-muted-foreground">{m.author_local_hint()}</p>
 {!snapshot.persistent?<Alert>{m.author_persistence_hint()}</Alert>:null}
 {!snapshot.capable?<Alert>{m.author_batch_unavailable()}</Alert>:null}
 {failure?<Alert variant="destructive">{chartErrorMessage(failure)}<Button variant="outline" onClick={()=>void page.refetch()}>{m.author_retry()}</Button></Alert>:null}
 {snapshot.failure?<Alert variant="destructive">{snapshot.failure}</Alert>:null}
 {page.data?<p>{m.author_quota()}: {page.data.counts.total} / 50 · {m.chart_usage({used:(page.data.usage.usedBytes/1048576).toFixed(2),quota:"256"})} · {m.chart_usage_reserved({reserved:(page.data.usage.reservedBytes/1048576).toFixed(2)})}</p>:null}
 <fieldset disabled={busy||!snapshot.capable} className="min-w-0 space-y-4 rounded-lg border p-4"><legend>{m.author_imports()}</legend>
 <div><label htmlFor={`${id}-archives`} className="block">{m.author_add_archives()}</label><input id={`${id}-archives`} type="file" className="max-w-full" accept=".adx,.zip,application/zip" multiple onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)run(()=>store.add(files.map(file=>({file}))));}}/></div>
 <div><label htmlFor={`${id}-folder`} className="block">{m.author_add_folder()}</label><input id={`${id}-folder`} type="file" className="max-w-full" {...{webkitdirectory:"",directory:""}} multiple onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)run(()=>store.add([{folder:files}]));}}/></div>
 <fieldset className="min-w-0 space-y-3 rounded border p-3"><legend>{m.chart_parts_title()}</legend><div className="grid gap-3 sm:grid-cols-2">{([["maidata",m.chart_part_maidata(),".txt"],["audio",m.chart_part_audio(),".mp3,.ogg,.wav"],["cover",m.chart_part_cover(),".jpg,.jpeg,.png,.webp"],["video",m.chart_part_video(),".mp4,.webm"]] as const).map(([role,label,accept])=><div key={role} className="min-w-0"><label className="block" htmlFor={`${id}-${role}`}>{label}</label><input id={`${id}-${role}`} className="max-w-full" type="file" accept={accept} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)setParts(p=>({...p,[role]:file}));}}/>{parts[role]?<p className="break-all text-sm">{parts[role]!.name}<button className="ml-2 underline" type="button" onClick={()=>setParts(p=>{const next={...p};delete next[role];return next;})}>{m.chart_part_remove()}</button></p>:null}</div>)}</div><Button disabled={!parts.maidata} onClick={()=>run(async()=>{await store.add([{parts}]);setParts({});})}>{m.author_add_parts()}</Button></fieldset>
 </fieldset>
 <p>{m.author_total()}: {rows.length} / 10 · {(rows.reduce((n,r)=>n+r.rawSize,0)/1048576).toFixed(2)} / 256 MiB</p>
 <p className="text-sm">{m.author_results_hint()}</p>
 <MotionGroup as="ul" className="space-y-3">{rows.map(row=><MotionSurface as="li" key={row.id} className="space-y-3 rounded-lg border p-4"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,row.id]:s.filter(i=>i!==row.id))}/><span className="break-all">{row.name}</span></label>
 <div className="flex flex-wrap items-center gap-3"><label htmlFor={`${id}-${row.id}`}>{m.author_target()}</label><select id={`${id}-${row.id}`} className="min-h-11 max-w-full rounded border p-2" disabled={busy||["saved","saving","uncertain","cancelled"].includes(row.phase)} value={row.target?.id??""} onChange={e=>{const target=page.data?.targets.find(t=>t.id===e.target.value);run(()=>store.map(row.id,target?{id:target.id,revision:target.revision}:null));}}><option value="">{m.author_new_target()}</option>{page.data?.targets.map(t=><option key={t.id} value={t.id}>{t.title} · {t.versionCount}/20 · r{t.revision}</option>)}</select>{row.target?<span>r{row.target.revision}</span>:null}</div>
 <p role="status">{importPhaseLabel(row.phase)} · {(row.size/1048576).toFixed(2)} MiB</p>{["hashing","uploading"].includes(row.phase)?<progress max={1} value={row.progress} aria-label={importPhaseLabel(row.phase)} className="w-full"/>:null}
 {row.failure?<p role="alert" className="text-destructive">{row.failure}</p>:null}
 {row.hash?<p className="break-all font-mono text-xs">SHA256 {row.hash}</p>:null}
 {row.phase==="saved"&&row.result?<Link className={textLinkClass} to={localizeHref(`/me/charts/${row.result.chartId}/review?version=${row.result.versionId}`)}>{m.author_review()}</Link>:null}
 {row.failure==="CHART_CHANGED"&&row.target?<Button variant="outline" disabled={busy} onClick={()=>run(async()=>{const latest=await page.refetch();const target=latest.data?.targets.find(t=>t.id===row.target!.id);if(!target)throw Error("NOT_FOUND");await store.map(row.id,{id:target.id,revision:target.revision});})}>{m.author_reconfirm()}</Button>:null}
 {!row.fileId&&["paused","failed"].includes(row.phase)?<ImportReselect busy={busy} onSelect={selection=>run(()=>store.reselect(row.id,selection))}/>:null}
 {!["uploading","processing","saving"].includes(row.phase)?<Button variant="outline" disabled={busy} onClick={()=>run(()=>store.remove(row.id))}>{m.author_remove()}</Button>:null}
 </MotionSurface>)}</MotionGroup>
 <div className="flex flex-wrap gap-3"><Button disabled={busy||!rows.length||!page.data||!snapshot.capable} onClick={()=>run(()=>store.start())}>{m.author_start()}</Button><Button disabled={busy||!chosen.some(r=>r.phase==="ready")} onClick={()=>run(async()=>{await store.save(chosen.filter(r=>r.phase==="ready").map(r=>r.id));await page.refetch();})}>{m.author_save_selected()}</Button><Button variant="outline" disabled={busy||!rows.length} onClick={()=>run(()=>store.reconcile(selected.length?selected:allIds))}>{m.author_reconcile()}</Button><Button variant="outline" disabled={!busy} onClick={()=>store.pause()}>{m.author_pause()}</Button><Button variant="outline" disabled={!chosen.length} onClick={()=>run(()=>store.cancel(selected))}>{m.author_cancel_selected()}</Button></div>
 </main>;
}
