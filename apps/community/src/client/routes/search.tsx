import {data,Link,useLocation} from 'react-router';
import {m} from '@/paraglide/messages.js';
import {localizeHref} from '@/paraglide/runtime.js';
import {apiContext} from '@/shared/router-context';
import {parseDiscoveryInput,SEARCH_TYPES} from '@/shared/discovery-search';
import {ApiError} from '@/shared/api-client';
import {publicChartSearchParams} from '@/shared/public-chart-search';
import {DiscoverySearch} from '../components/discovery-search';
import {SearchGroupSection,SearchPagination,RandomDiscovery,typeLabel} from '../components/discovery-ui';
import {PublicChartBrowser,PublicChartSearchForm} from '../components/public-chart-browser';
import {ShareChartButton} from '../components/share-chart-button';
import {ErrorCard} from '../components/error-card';
import {PageTitle} from '../components/page-title';
import {discoveryApi} from '../queries/discovery';
import {canonicalLink,localeAlternates,originFrom} from '../lib/seo';
import {publicHeaders} from './public-charts';
import type {Route} from './+types/search';
export const headers=()=>publicHeaders;
export const shouldRevalidate=()=>true;
export async function loader({context,url}:Route.LoaderArgs){try{parseDiscoveryInput(url.searchParams);return data(await discoveryApi(context.get(apiContext)).search(url.searchParams),{headers:publicHeaders});}catch(e){throw data(null,{status:e instanceof RangeError?400:e instanceof ApiError?e.status:503,headers:publicHeaders});}}
export function meta({matches,location}:Route.MetaArgs){const o=originFrom(matches);return [{title:`${m.discovery_search_label()} - ${m.site_name()}`},{name:'robots',content:'noindex,follow'},canonicalLink(o,location.pathname),...localeAlternates(o,location.pathname)];}
export default function Search({loaderData:r}:Route.ComponentProps){const location=useLocation(),params=new URLSearchParams(location.search),input=parseDiscoveryInput(params),share=publicChartSearchParams(input.filters);if(input.type!=='all')share.set('type',input.type);
 const group=r.type==='all'?null:r.groups[r.type];
 return <main className="space-y-6"><PageTitle description={m.discovery_public_info()}>{m.discovery_search_label()}</PageTitle><DiscoverySearch initialQuery={r.query}/><nav aria-label={m.discovery_search_label()} className="flex flex-wrap gap-3">{(['all',...SEARCH_TYPES] as const).map(type=>{const p=new URLSearchParams({q:r.query});if(type!=='all')p.set('type',type);return <Link key={type} aria-current={r.type===type?'page':undefined} className={`min-h-11 rounded-full border px-4 py-2 ${r.type===type?'bg-primary text-primary-foreground':''}`} to={`${localizeHref('/search')}?${p}`}>{type==='all'?m.discovery_all():typeLabel(type)}</Link>;})}</nav>
 <ShareChartButton title={m.discovery_search_label()} resource="search" publicId="" searchParams={share.toString()}/>
 {r.type==='all'&&SEARCH_TYPES.some(t=>r.groups[t].status==='unavailable')?<p role="status">{m.discovery_partial()}</p>:null}
 {r.type==='charts'&&group?<><PublicChartSearchForm filters={input.filters} base={localizeHref('/search')} facets={r.facets}/><PublicChartBrowser base={localizeHref('/search')} filters={input.filters} page={{items:group.items.map(h=>h.chart!),nextCursor:group.nextCursor,total:group.total,facets:r.facets}}/><ul className="space-y-1">{group.items.filter(h=>h.reason).map(h=><li className="break-words text-xs text-muted-foreground" key={h.publicId}><Link className="underline" to={localizeHref(h.url)}>{h.title}</Link> · {h.reason?.label}</li>)}</ul></>:r.type==='all'?SEARCH_TYPES.map(t=>{const p=new URLSearchParams(share);p.set('type',t);p.delete('sort');return <SearchGroupSection key={t} type={t} group={r.groups[t]} more={`${localizeHref('/search')}?${p}`}/>;}):group?<><SearchGroupSection type={r.type} group={group}/><SearchPagination cursor={group.nextCursor}/></>:null}
 {group?.total===0?<div className="flex flex-wrap gap-4"><Link className="underline" to={localizeHref('/tags')}>{m.discovery_tags()}</Link><Link className="underline" to={localizeHref('/authors')}>{m.discovery_authors()}</Link><RandomDiscovery/></div>:null}</main>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
