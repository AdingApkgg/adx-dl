import {data} from 'react-router';
import {m} from '@/paraglide/messages.js';
import {apiContext} from '@/shared/router-context';
import {PageTitle} from '../components/page-title';
import {DiscoverySearch} from '../components/discovery-search';
import {DiscoverySections} from '../components/discovery-ui';
import {discoveryApi} from '../queries/discovery';
import {ErrorCard} from '../components/error-card';
import {canonicalLink,localeAlternates,originFrom} from '../lib/seo';
import {publicHeaders} from './public-charts';
import type {Route} from './+types/discover';
export const headers=()=>publicHeaders;export const shouldRevalidate=()=>true;
export async function loader({context}:Route.LoaderArgs){return data(await discoveryApi(context.get(apiContext)).discover(),{headers:publicHeaders});}
export function meta({matches,location}:Route.MetaArgs){const o=originFrom(matches);return [{title:`${m.discovery_title()} - ${m.site_name()}`},canonicalLink(o,location.pathname),...localeAlternates(o,location.pathname)];}
export default function Discover({loaderData}:Route.ComponentProps){return <main className="space-y-7"><PageTitle description={m.discovery_intro()}>{m.discovery_title()}</PageTitle><DiscoverySearch/><DiscoverySections value={loaderData}/></main>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
