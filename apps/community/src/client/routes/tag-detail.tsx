import {data} from 'react-router';
import {m} from '@/paraglide/messages.js';
import {localizeHref} from '@/paraglide/runtime.js';
import {apiContext} from '@/shared/router-context';
import {normalizeChartTags} from '@/shared/chart-metadata';
import {publicChartFiltersFromParams} from '@/shared/public-chart-search';
import {PageTitle} from '../components/page-title';
import {PublicChartBrowser,PublicChartSearchForm} from '../components/public-chart-browser';
import {ErrorCard} from '../components/error-card';
import {publicChartsApi} from '../queries/public-charts';
import {publicHeaders} from './public-charts';
import {canonicalLink,localeAlternates,originFrom} from '../lib/seo';
import type {Route} from './+types/tag-detail';
export const headers=()=>publicHeaders;export const shouldRevalidate=()=>true;
export async function loader({context,params,url}:Route.LoaderArgs){let tag;try{tag=normalizeChartTags([params.key])[0];}catch{throw data(null,{status:400,headers:publicHeaders});}const p=new URLSearchParams(url.search);p.delete('tagLines');p.delete('tags');p.delete('tag[]');p.set('tag',tag.key);const f=publicChartFiltersFromParams(p);return data({tag,filters:f,page:await publicChartsApi(context.get(apiContext)).list(p.get('cursor')??undefined,undefined,f)},{headers:publicHeaders});}
export function meta({loaderData,matches,location}:Route.MetaArgs){const o=originFrom(matches);return [{title:`${loaderData?.tag.label??m.discovery_tags()} - ${m.site_name()}`},canonicalLink(o,location.pathname),...localeAlternates(o,location.pathname),{name:'robots',content:'noindex,follow'}];}
export default function Tag({loaderData:r}:Route.ComponentProps){return <main className="space-y-6"><PageTitle>{r.tag.label}</PageTitle><PublicChartSearchForm filters={r.filters} base={localizeHref('/charts')} facets={r.page.facets}/><PublicChartBrowser page={r.page} filters={r.filters} base={localizeHref('/charts')}/></main>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
