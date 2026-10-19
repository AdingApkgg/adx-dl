import {data,Link,useLocation} from 'react-router';
import {Button} from '@astrodx/ui/components/button';
import {Input} from '@astrodx/ui/components/input';
import {m} from '@/paraglide/messages.js';
import {localizeHref} from '@/paraglide/runtime.js';
import {apiContext} from '@/shared/router-context';
import {ApiError} from '@/shared/api-client';
import {PageTitle} from '../components/page-title';
import {SearchPagination} from '../components/discovery-ui';
import {ErrorCard} from '../components/error-card';
import {discoveryApi} from '../queries/discovery';
import {canonicalLink,localeAlternates,originFrom} from '../lib/seo';
import {publicHeaders} from './public-charts';
import type {Route} from './+types/tags';
export const headers=()=>publicHeaders;export const shouldRevalidate=()=>true;
export async function loader({context,url}:Route.LoaderArgs){try{return data(await discoveryApi(context.get(apiContext)).tags(url.searchParams),{headers:publicHeaders});}catch(e){throw data(null,{status:e instanceof ApiError?e.status:503,headers:publicHeaders});}}
export function meta({matches,location}:Route.MetaArgs){const o=originFrom(matches);return [{title:`${m.discovery_tags()} - ${m.site_name()}`},canonicalLink(o,location.pathname),...localeAlternates(o,location.pathname),...(location.search?[{name:'robots',content:'noindex,follow'}]:[])];}
export default function Tags({loaderData:p}:Route.ComponentProps){const l=useLocation();return <main className="space-y-6"><PageTitle description={m.discovery_public_info()}>{m.discovery_tags()}</PageTitle><form role="search" method="get" action={localizeHref('/tags')} className="flex gap-2"><Input name="q" aria-label={m.chart_metadata_tags()} defaultValue={new URLSearchParams(l.search).get('q')??''} maxLength={40}/><Button type="submit">{m.public_charts_search()}</Button></form>{p.items.length?<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{p.items.map(t=><li key={t.key}><Link to={localizeHref(`/tags/${encodeURIComponent(t.key)}`)} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-card p-4"><span className="break-words font-medium">{t.label}</span><span className="text-sm text-muted-foreground">{t.count}</span></Link></li>)}</ul>:<p role="status">{m.discovery_empty()}</p>}<SearchPagination cursor={p.nextCursor}/></main>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
