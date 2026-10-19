import {okJson,type ApiClient} from '@/shared/api-client';
import type {SearchResult,SearchHit,DiscoveryPage,AuthorSummary,DirectoryPage,SearchFacets} from '@/shared/discovery-search';
import type {PublicChartDto} from '@/shared/charts';
import type {PublicListSummary} from '@/shared/library';
export function discoveryApi(api:ApiClient){const r=api.api.v1;return {
 search:async(params:URLSearchParams):Promise<SearchResult>=>okJson(await r.search.$get({query:Object.fromEntries(params)},{init:{cache:'no-store'}})),
 suggestions:async(q:string,signal?:AbortSignal):Promise<SearchHit[]>=>okJson(await r.search.suggestions.$get({query:{q}},{init:{cache:'no-store',signal}})),
 discover:async():Promise<DiscoveryPage>=>okJson(await r.discovery.$get({},{init:{cache:'no-store'}})),
 authors:async(params:URLSearchParams):Promise<DirectoryPage<AuthorSummary>>=>okJson(await r.authors.$get({query:Object.fromEntries(params)},{init:{cache:'no-store'}})),
 tags:async(params:URLSearchParams):Promise<DirectoryPage<SearchFacets['tags'][number]>>=>okJson(await r.tags.$get({query:Object.fromEntries(params)},{init:{cache:'no-store'}})),
 random:async(params:URLSearchParams=new URLSearchParams()):Promise<PublicChartDto|null>=>okJson(await r.charts.random.$get({query:Object.fromEntries(params)},{init:{cache:'no-store'}})),
 lists:async(id:string):Promise<PublicListSummary[]>=>okJson(await r.charts[':id']['public-lists'].$get({param:{id}},{init:{cache:'no-store'}})),
};}
