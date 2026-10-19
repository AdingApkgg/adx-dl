import {SearchText} from "./search-text";
import { Button } from "@astrodx/ui/components/button";
import { Input } from "@astrodx/ui/components/input";
import { ArrowDownUpIcon, ListFilterIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { localizeHref } from "@/paraglide/runtime.js";
import { Link, useLocation, useNavigate } from "react-router";
import { publicChartsApi } from "../queries/public-charts";
import { getRenderApi } from "../lib/browser";
import { m } from "@/paraglide/messages.js";
import type { PublicChartsPageDto } from "@/shared/charts";
import { publicChartFiltersFromParams, PUBLIC_CHART_SEARCH_MAX, publicChartSearchParams, type PublicChartFilters } from "@/shared/public-chart-search";
import { publicListReturnState, samePublicListScope } from "../lib/public-chart-navigation";
import { ChartSelection } from "./library-selection";
import { PUBLIC_CHART_GRID_CLASS, PublicChartCard, PublicCover, PublicDifficultyPill, publicDifficultyName } from "./public-chart-card";

export function PublicChartSearchForm({ filters, base, facets }: { filters: PublicChartFilters; base: string; facets?: import("@/shared/discovery-search").SearchFacets | null }) {
  const navigate=useNavigate(),id=useId(),[error,setError]=useState(false);
  const query=publicChartSearchParams(filters).toString(),search=/\/search$/.test(base);
  function href(f:PublicChartFilters){const p=publicChartSearchParams(f);if(search)p.set("type","charts");return base+(p.size?`?${p}`:"");}
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const p=new URLSearchParams();for(const [k,v] of new FormData(event.currentTarget))if(typeof v==="string"&&v)p.append(k,v);
    try{publicChartFiltersFromParams(p);setError(false);void navigate(base+(p.size?`?${p}`:""));}catch{setError(true);}}
  const tags=filters.tags??(filters.tag?[filters.tag]:[]),levels=filters.levels??[];
  const initialTags=tags.join("\n"),initialLevels=levels.join("\n");
  const [tagLines,setTagLines]=useState(initialTags),[levelLines,setLevelLines]=useState(initialLevels);
  useEffect(()=>{setTagLines(initialTags);setLevelLines(initialLevels);},[initialTags,initialLevels]);
  const append=(old:string,value:string,max:number)=>{const rows=old.split("\n").map(v=>v.trim()).filter(Boolean);return rows.includes(value)||rows.length>=max?old:[...rows,value].join("\n");};
  const chip=(label:string,next:PublicChartFilters)=><Link key={label} className="min-h-11 rounded-full border px-3 py-2 text-sm underline-offset-4 hover:underline" to={href(next)}>{label} ×</Link>;
  return <form key={query} method="get" action={base} onSubmit={submit} role="search" aria-label={m.public_charts_search()} className="space-y-4 rounded-xl border bg-card/80 p-4">
    {search?<input type="hidden" name="type" value="charts"/>:null}
    <div className="flex gap-2"><Input name="q" type="search" defaultValue={filters.q} maxLength={240} aria-label={m.public_charts_search()} placeholder={m.discovery_search_hint()} className="min-h-11 min-w-0 flex-1"/><Button type="submit" className="min-h-11">{m.public_charts_search()}</Button></div>
    <div className="flex flex-wrap gap-3"><label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">{m.chart_difficulties()}<select name="difficulty" defaultValue={filters.difficulty??""} className="min-h-11 rounded border bg-background px-3"><option value="">{m.public_charts_all_difficulties()}</option>{([1,2,3,4,5,6,7] as const).map(d=><option key={d} value={d}>{publicDifficultyName(d)}</option>)}</select></label>
    <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">{m.public_charts_sort()}<select name="sort" defaultValue={filters.sort} className="min-h-11 rounded border bg-background px-3"><option value="relevance">{m.discovery_relevance()}</option><option value="collected">{m.discovery_collected()}</option><option value="updated">{m.public_charts_sort_updated()}</option><option value="published">{m.public_charts_sort_published()}</option><option value="title">{m.discovery_name_sort()}</option></select></label></div>
    <details open={!!(tags.length||levels.length||filters.designer||filters.minSeconds!==undefined||filters.maxSeconds!==undefined||filters.preview)}><summary className="min-h-11 cursor-pointer py-2 font-medium">{m.discovery_advanced()}</summary><div className="grid gap-4 pt-2 sm:grid-cols-2">
      <label className="space-y-1 text-sm">{m.chart_metadata_tags()}<textarea name="tagLines" rows={3} maxLength={2048} value={tagLines} onChange={e=>setTagLines(e.target.value)} className="block w-full rounded border bg-background p-2"/><span className="block text-xs text-muted-foreground">{m.discovery_tag_hint()}</span>{facets?.tags.length?<span className="flex flex-wrap gap-1">{facets.tags.map(t=><Button type="button" variant="outline" size="sm" key={t.key} onClick={()=>setTagLines(v=>append(v,t.key,5))}>＋ {t.label} ({t.count})</Button>)}</span>:null}</label>
      <label className="space-y-1 text-sm">{m.discovery_levels()}<textarea name="levelLines" rows={3} maxLength={2048} value={levelLines} onChange={e=>setLevelLines(e.target.value)} className="block w-full rounded border bg-background p-2"/><span className="block text-xs text-muted-foreground">{m.discovery_levels_hint()}</span>{facets?.levels.length?<span className="flex flex-wrap gap-1">{facets.levels.map(t=><Button type="button" variant="outline" size="sm" key={t.value} onClick={()=>setLevelLines(v=>append(v,t.value,8))}>＋ {t.value} ({t.count})</Button>)}</span>:null}</label>
      <label className="space-y-1 text-sm">{m.discovery_reason_author()}<Input name="author" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={19} defaultValue={filters.author??""}/></label>
      <label className="space-y-1 text-sm">{m.discovery_reason_designer()}<Input name="designer" maxLength={240} defaultValue={filters.designer??""} list={id}/><datalist id={id}>{facets?.designers.map(t=><option key={t.value} value={t.value}>{t.count}</option>)}</datalist></label>
      <div className="grid grid-cols-2 gap-2"><label className="space-y-1 text-sm">{m.discovery_min_seconds()}<Input name="minSeconds" type="number" min={0} max={3600} step={1} defaultValue={filters.minSeconds??""}/></label><label className="space-y-1 text-sm">{m.discovery_max_seconds()}<Input name="maxSeconds" type="number" min={0} max={3600} step={1} defaultValue={filters.maxSeconds??""}/></label></div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input name="preview" type="checkbox" value="1" defaultChecked={filters.preview}/>{m.discovery_preview_only()}</label>
    </div><p className="pt-3 text-sm text-muted-foreground">{m.discovery_same_slot()}</p></details>
    <div className="flex flex-wrap gap-2">{tags.map(t=>chip(t,{...filters,tag:undefined,tags:tags.filter(v=>v!==t)}))}{levels.map(t=>chip(t,{...filters,levels:levels.filter(v=>v!==t)}))}{filters.designer?chip(filters.designer,{...filters,designer:undefined}):null}{filters.difficulty?chip(publicDifficultyName(filters.difficulty),{...filters,difficulty:undefined}):null}{filters.author?chip(`${m.discovery_reason_author()} #${filters.author}`,{...filters,author:undefined}):null}{filters.minSeconds!==undefined?chip(`${m.discovery_min_seconds()} ${filters.minSeconds}`,{...filters,minSeconds:undefined}):null}{filters.maxSeconds!==undefined?chip(`${m.discovery_max_seconds()} ${filters.maxSeconds}`,{...filters,maxSeconds:undefined}):null}{filters.preview?chip(m.discovery_preview_only(),{...filters,preview:undefined}):null}{query?<Button asChild variant="ghost"><Link to={base+(search?"?type=charts":"")}>{m.public_charts_clear()}</Link></Button>:null}</div>
    {error?<p role="alert">{m.discovery_filters_invalid()}</p>:null}
  </form>;
}

export function PublicChartBrowser({ page, filters, base, headingLevel = 2 }: {
  page: PublicChartsPageDto; filters: PublicChartFilters; base: string; headingLevel?: 2 | 3;
}) {
  const location = useLocation(),navigate=useNavigate();
  const [preferred,setPreferred]=useState("grid");
  useEffect(()=>{try{const p=localStorage.getItem("adxc-public-view");if(p==="list")setPreferred(p);}catch{}},[]);
  const viewParam=new URLSearchParams(location.search).get("view"),view=viewParam==="list"||viewParam==="grid"?viewParam:preferred;
  function changeView(value:string){setPreferred(value);try{localStorage.setItem("adxc-public-view",value);}catch{}const p=new URLSearchParams(location.search);p.set("view",value);void navigate(location.pathname+"?"+p);}
  const current = `${location.pathname}${location.search}`;
  const origin = publicListReturnState(location.state);
  const candidates: unknown[] = Array.isArray(location.state?.publicChartCursors) ? location.state.publicChartCursors.slice(-100) : [];
  const cursors = candidates.filter(href => samePublicListScope(href, current));
  const params = publicChartSearchParams(filters);
  // An author page scopes queries server-side; its identity is already in the pathname.
  if (/\/u\//.test(base)) params.delete("author");
  if(/\/search$/.test(base))params.set("type","charts");
  if(viewParam)params.set("view",view);
  const query = params.toString(), first = base + (query ? `?${query}` : "");
  const nextParams = new URLSearchParams(params);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);
  const hasCursor = new URLSearchParams(location.search).has("cursor");
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">{page.total!==undefined&&page.total!==null?<p className="text-sm text-muted-foreground">{m.discovery_count({count:String(page.total)})}</p>:null}<div className="flex gap-2"><Button variant={view==="grid"?"default":"outline"} aria-pressed={view==="grid"} onClick={()=>changeView("grid")}>{m.discovery_view_grid()}</Button><Button variant={view==="list"?"default":"outline"} aria-pressed={view==="list"} onClick={()=>changeView("list")}>{m.discovery_view_list()}</Button></div></div>
    {page.items.length ? <ul className={view==="list"?"space-y-3":PUBLIC_CHART_GRID_CLASS}>{page.items.map(chart => <li key={chart.id}>{view==="list"?<article className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-3"><div className="w-20 shrink-0 overflow-hidden rounded"><PublicCover chart={chart}/></div><div className="min-w-0 flex-1 space-y-2"><Link to={localizeHref(`/charts/${chart.publicId}`)} state={{publicListHref:current,publicListCursors:cursors}} className="break-words font-semibold underline"><SearchText text={chart.title} query={filters.q}/></Link><p className="break-words text-sm text-muted-foreground">{chart.artist}</p><ul className="flex flex-wrap gap-1">{chart.summary.difficulties.map(d=><li key={d.difficulty}><PublicDifficultyPill row={d}/></li>)}</ul></div><ChartSelection publicId={chart.publicId}/></article>:<PublicChartCard chart={chart} headingLevel={headingLevel} query={filters.q}/>}</li>)}</ul>
      : <p role="status" className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">{filters.q || filters.tag || filters.difficulty || filters.sort !== "updated" ? m.public_charts_no_results() : m.public_charts_empty()}</p>}
    <nav aria-label={m.public_charts_pagination()} className="flex flex-wrap gap-3">
      {hasCursor ? <Button asChild variant="outline" className="min-h-11"><Link to={cursors.at(-1) ?? first} state={{ ...origin, publicChartCursors: cursors.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
      {page.nextCursor ? <Button asChild variant="outline" className="min-h-11"><Link to={`${base}?${nextParams}`} state={{ ...origin, publicChartCursors: [...cursors, current] }}>{m.chart_next()}</Link></Button> : null}
    </nav>
  </div>;
}
