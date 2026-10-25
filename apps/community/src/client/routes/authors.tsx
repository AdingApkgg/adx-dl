import { EmptyState } from "../components/ui-states";
import {data,Form,Link,useLocation} from 'react-router';
import {Button} from '@astrodx/ui/components/button';
import {Input} from '@astrodx/ui/components/input';
import {m} from '@/paraglide/messages.js';
import {localizeHref} from '@/paraglide/runtime.js';
import {apiContext} from '@/shared/router-context';
import {ApiError} from '@/shared/api-client';
import {PageTitle} from '../components/page-title';
import {FollowAuthor} from '../components/follow-author';
import {ShareChartButton} from '../components/share-chart-button';
import {SearchPagination} from '../components/discovery-ui';
import {ErrorCard} from '../components/error-card';
import {discoveryApi} from '../queries/discovery';
import {canonicalLink,localeAlternates,originFrom} from '../lib/seo';
import {publicHeaders} from './public-charts';
import type {Route} from './+types/authors';
export const headers=()=>publicHeaders;export const shouldRevalidate=()=>true;
export async function loader({context,url}:Route.LoaderArgs){try{return data(await discoveryApi(context.get(apiContext)).authors(url.searchParams),{headers:publicHeaders});}catch(e){throw data(null,{status:e instanceof ApiError?e.status:503,headers:publicHeaders});}}
export function meta({matches,location}:Route.MetaArgs){const o=originFrom(matches);return [{title:`${m.discovery_authors()} - ${m.site_name()}`},canonicalLink(o,location.pathname),...localeAlternates(o,location.pathname),...(location.search?[{name:'robots',content:'noindex,follow'}]:[])];}
export default function Authors({loaderData:p}:Route.ComponentProps){const l=useLocation(),params=new URLSearchParams(l.search);return <main className="space-y-6"><PageTitle description={m.discovery_public_info()}>{m.discovery_authors()}</PageTitle><Form key={JSON.stringify([params.get('q')??'',params.get('sort')??'name'])} method="get" action={localizeHref('/authors')} role="search" className="community-filter community-toolbar"><Input name="q" aria-label={m.discovery_authors()} defaultValue={params.get('q')??''} maxLength={240} className="min-w-0 flex-1"/><select name="sort" defaultValue={params.get('sort')??'name'} aria-label={m.public_charts_sort()} className="min-h-11 rounded border bg-background p-2"><option value="name">{m.discovery_name_sort()}</option><option value="recent">{m.discovery_recent_contribution()}</option></select><Button type="submit">{m.public_charts_search()}</Button></Form>{p.items.length?<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{p.items.map(a=><li key={a.publicId} className="space-y-3 rounded-xl border bg-card p-4"><h2 className="break-words font-semibold"><Link className="underline" to={localizeHref(`/u/${a.publicId}`)}>{a.name}</Link></h2><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{a.bio}</p><p className="text-sm">{m.discovery_count({count:String(a.count)})}</p><FollowAuthor publicId={a.publicId}/><ShareChartButton title={a.name} resource="u" publicId={a.publicId}/></li>)}</ul>:<EmptyState title={m.discovery_empty()} description={params.get('q')?m.ui_search_empty_hint():undefined}><Link className="community-inline-action" to={localizeHref(params.get('q')?'/'+"authors":'/discover')}>{params.get('q')?m.public_charts_clear():m.discovery_title()}</Link></EmptyState>}<SearchPagination cursor={p.nextCursor}/></main>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
