import {Alert} from "@astrodx/ui/components/alert";
import {Button} from "@astrodx/ui/components/button";
import {dehydrate,HydrationBoundary,useQuery} from "@tanstack/react-query";
import {useState} from "react";
import {Link,useSearchParams} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {apiContext,queryClientContext} from "@/shared/router-context";
import type {WorkbenchFilters} from "@/shared/author-workbench";
import {PageTitle,textLinkClass} from "../components/page-title";
import {requireUser} from "../lib/require-user";
import {getRenderApi} from "../lib/browser";
import {chartErrorMessage} from "../lib/chart-errors";
import {useImports} from "../imports/provider";
import {workbenchQuery} from "../queries/charts";
import type {Route} from "./+types/workbench";
function filters(params:URLSearchParams):WorkbenchFilters{return {q:params.get("q")??"",status:params.get("status")??"all",changed:params.get("changed")==="1",warnings:params.get("warnings")==="1",pending:params.get("pending")==="1"};}
export async function loader({context,url}:Route.LoaderArgs){const me=await requireUser(context,url),client=context.get(queryClientContext);await client.query(workbenchQuery(context.get(apiContext),me.id,filters(url.searchParams)));return {actor:me.id,dehydratedState:dehydrate(client)};}
export function meta(){return [{title:`${m.author_workbench()} - ${m.site_name()}`},{name:"robots",content:"noindex"}];}
export default function Workbench({loaderData}:Route.ComponentProps){return <HydrationBoundary state={loaderData.dehydratedState}><Workspace actor={loaderData.actor}/></HydrationBoundary>;}
function Workspace({actor}:{actor:string}){
 const [params,setParams]=useSearchParams(),base=filters(params),key=JSON.stringify(base),[history,setHistory]=useState<{key:string;cursors:(string|undefined)[]}>({key,cursors:[undefined]}),cursors=history.key===key?history.cursors:[undefined],imports=useImports();
 const query=useQuery({...workbenchQuery(getRenderApi(),actor,{...base,cursor:cursors.at(-1)}),enabled:!imports||imports.snapshot.scope===actor}),page=query.data;
 const move=(next:(string|undefined)[])=>setHistory({key,cursors:next});
 const local=imports?.snapshot.scope===actor?imports.snapshot.rows.filter(r=>!["saved","cancelled"].includes(r.phase)).length:0;
 if(imports&&imports.snapshot.scope!==actor)return <main><PageTitle>{m.author_workbench()}</PageTitle><p role="status">{m.author_analysis_loading()}</p></main>;
 return <main className="space-y-6 pb-24"><PageTitle description={m.author_scope_hint()}>{m.author_workbench()}</PageTitle><nav className="flex flex-wrap gap-3"><Button asChild><Link to={localizeHref("/me/imports")}>{m.author_imports()} · {local}</Link></Button><Link className={textLinkClass} to={localizeHref("/me/charts/new")}>{m.chart_new()}</Link><Link className={textLinkClass} to={localizeHref("/me/charts")}>{m.charts_title()}</Link></nav>
 {page?<><dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["total",m.author_total()],["private",m.author_private()],["published",m.author_public()],["changed",m.author_changed()],["warnings",m.author_warnings()],["hidden",m.author_hidden()],["pending",m.author_pending()]] as const).map(([name,label])=><div key={name} className="rounded border p-3"><dt className="text-sm">{label}</dt><dd className="text-2xl font-semibold">{page.counts[name]}</dd></div>)}</dl><p>{m.author_quota()}: {page.counts.total} / 50 · {m.chart_usage({used:(page.usage.usedBytes/1048576).toFixed(2),quota:"256"})} · {m.chart_usage_reserved({reserved:(page.usage.reservedBytes/1048576).toFixed(2)})}</p></>:null}
 <form role="search" className="space-y-3" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget),next=new URLSearchParams();for(const name of ["q","status","changed","warnings","pending"]){const value=form.get(name);if(value)next.set(name,String(value));}setParams(next);}}>
 <div className="flex flex-wrap gap-2"><input key={base.q} name="q" type="search" defaultValue={base.q} maxLength={240} aria-label={m.public_charts_search()} className="min-h-11 min-w-0 flex-1 rounded border p-2"/><select key={base.status} name="status" defaultValue={base.status} aria-label={m.chart_metadata_status()} className="min-h-11 rounded border p-2"><option value="all">{m.chart_metadata_all()}</option><option value="draft">{m.author_private()}</option><option value="published">{m.author_public()}</option><option value="hidden">{m.author_hidden()}</option></select><Button type="submit">{m.public_charts_search()}</Button></div>
 <div className="flex flex-wrap gap-4">{([["changed",m.author_changed()],["warnings",m.author_warnings()],["pending",m.author_pending()]] as const).map(([name,label])=><label key={`${name}/${base[name]}`} className="flex min-h-11 items-center gap-2"><input type="checkbox" name={name} value="1" defaultChecked={base[name]}/>{label}</label>)}</div></form>
 {query.error?<Alert variant="destructive">{chartErrorMessage(query.error)}<Button variant="outline" onClick={()=>void query.refetch()}>{m.author_retry()}</Button></Alert>:null}
 {page&&!page.items.length?<p>{m.author_empty()}</p>:null}
 <ul className="space-y-3">{page?.items.map(chart=><li key={chart.id} className="space-y-2 rounded-lg border p-4"><Link className={`${textLinkClass} break-words font-semibold`} to={localizeHref(`/me/charts/${chart.id}`)}>{chart.title}</Link><p className="break-words text-sm">{chart.artist}</p><p>{m.author_version()} {chart.currentOrdinal} · {chart.versionCount}/20 · {m.chart_warnings()} {chart.warningCount}</p><p>{m.author_public()}: {chart.publishedOrdinal??m.author_missing()}</p><p className="text-sm">{chart.moderated?m.author_hidden():chart.publicationPending?m.author_pending():chart.changed?m.author_changed():chart.publication?m.author_public():m.author_private()}</p><time dateTime={chart.updatedAt} className="text-xs text-muted-foreground">{chart.updatedAt.slice(0,19)}</time><nav className="flex flex-wrap gap-3"><Link className={textLinkClass} to={localizeHref(`/me/charts/${chart.id}/review`)}>{m.author_review()}</Link><Link className={textLinkClass} to={localizeHref(`/me/charts/${chart.id}/compare`)}>{m.author_compare()}</Link><Link className={textLinkClass} to={localizeHref(`/me/charts/${chart.id}#publication`)}>{m.chart_publication()}</Link></nav></li>)}</ul>
 <div className="flex gap-2">{cursors.length>1?<Button variant="outline" disabled={query.isFetching} onClick={()=>move(cursors.slice(0,-1))}>{m.chart_previous()}</Button>:null}{page?.nextCursor?<Button variant="outline" disabled={query.isFetching} onClick={()=>move([...cursors,page.nextCursor!])}>{m.chart_next()}</Button>:null}</div>
 </main>;
}
