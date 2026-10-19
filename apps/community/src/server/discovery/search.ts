import {sql,type SQL} from 'drizzle-orm';
import type {StorageContext} from '../storage/contracts';
import {StorageUnavailableError} from '../storage/errors';
import {SEARCH_TYPES,normalizeSearchText,type DiscoveryInput,type SearchType,type SearchGroup,type SearchHit,type SearchResult,type SearchFacets} from '@/shared/discovery-search';
import {parsePublicChartFilters,type PublicChartSearchInput,type PublicChartFilters} from '@/shared/public-chart-search';
import type {PublicChartDto,PublicChartsPageDto} from '@/shared/charts';
import {entityRelation,chartRelation} from './visibility';
import {snapshot,groupSavepoint,rows,key,decodeCursor,encodeCursor,chartFilter,chartSlotFilter,termMatch,rankSelect,orderBy,afterCursor,invalid,type Cursor} from './query';
export const unavailable=():SearchGroup=>({status:'unavailable',items:[],total:null,nextCursor:null});
export const empty=():SearchGroup=>({status:'ready',items:[],total:0,nextCursor:null});
export type HitRow={id:string;public_id:string;title:string;description:string;at:string;kind:string;label:string;score:number;data:Record<string,unknown>};
const paths:Record<SearchType,string>={charts:'charts',authors:'u',lists:'lists',topics:'forum'};
function hit(type:SearchType,r:HitRow):SearchHit {
 return {type,publicId:r.public_id,title:r.title,description:[...(r.description??'')].slice(0,120).join(''),url:`/${paths[type]}/${r.public_id}`,updatedAt:new Date(r.at).toISOString(),reason:r.score>0?{kind:r.kind as NonNullable<SearchHit['reason']>['kind'],label:r.label}:null,...(type==='charts'?{chart:r.data as unknown as PublicChartDto}:{}),...(type==='authors'?{image:r.data.image as string|null,count:Number(r.data.count)}:{}),...(type==='lists'?{count:Number(r.data.total)}:{}),...(type==='topics'?{board:{id:String(r.data.boardId),name:String(r.data.boardName)}}:{})};
}
export function rankedRelation(ctx:StorageContext,type:SearchType,f:PublicChartFilters):SQL {
 return sql`select c.*,date_trunc('milliseconds',${f.sort==='published'?sql`c.published`:sql`c.at`}) sort_at,b.kind,b.label,b.score from (${entityRelation(ctx,type)}) c cross join lateral(${rankSelect(f.q)}) b where ${termMatch(f.q)} and ${type==='charts'?chartFilter(f):sql`true`}`;
}
export function groupStatement(ctx:StorageContext,type:SearchType,f:PublicChartFilters,cursor:Cursor|null,limit:number):SQL {
 const ranked=rankedRelation(ctx,type,f);
 return sql`with ranked0 as materialized(${ranked}), ranked as(select id,public_id,title,description,sort_at at,kind,label,score,data from ranked0)
 select (select count(*)::integer from ranked) total,coalesce((select jsonb_agg(p) from (select * from ranked where ${afterCursor(f,cursor)} order by ${orderBy(f)} limit ${limit+1}) p),'[]'::jsonb) items`;
}
export async function queryGroup(ctx:StorageContext,type:SearchType,f:PublicChartFilters,after?:string,limit=20):Promise<SearchGroup> {
 if(type==='lists'){const [ready]=await rows<{ready:boolean}>(ctx.db,sql`select ready from chart_library_status where id='global'`);if(!ready?.ready)throw new StorageUnavailableError();}
 const scope=key({algorithm:1,type,f:{...f,q:normalizeSearchText(f.q)}}),cursor=decodeCursor(after,scope);
 const [r]=await rows<{total:number;items:HitRow[]}>(ctx.db,groupStatement(ctx,type,f,cursor,limit));
 const selected=(r?.items??[]).slice(0,limit),last=selected.at(-1);
 return {status:'ready',items:selected.map(row=>hit(type,row)),total:r?.total??0,nextCursor:(r?.items.length??0)>limit&&last?encodeCursor({scope,score:last.score,at:new Date(last.at).toISOString(),id:last.public_id,title:normalizeSearchText(last.title)}):null};
}
export async function queryFacets(ctx:StorageContext,f:PublicChartFilters):Promise<SearchFacets> {
 const [r]=await rows<SearchFacets>(ctx.db,sql`with c as materialized(select c.* from (${chartRelation(ctx)}) c where ${chartFilter(f)} and ${termMatch(f.q)})
 select coalesce((select jsonb_agg(x) from (select t->>'key' key,min(t->>'label' collate "C") label,count(distinct c.public_id)::integer count from c cross join lateral jsonb_array_elements(c.data->'tags') t group by t->>'key' order by count desc,(t->>'key') collate "C" limit 20)x),'[]') tags,
 coalesce((select jsonb_agg(x) from (select adxc_text_key(d->>'level') value,count(distinct c.public_id)::integer count from c cross join lateral jsonb_array_elements(c.data->'summary'->'difficulties') d where coalesce(d->>'level','')<>'' and ${chartSlotFilter(f)} group by adxc_text_key(d->>'level') order by count desc,adxc_text_key(d->>'level') collate "C" limit 20)x),'[]') levels,
 coalesce((select jsonb_agg(x) from (select adxc_text_key(d->>'designer') value,count(distinct c.public_id)::integer count from c cross join lateral jsonb_array_elements(c.data->'summary'->'difficulties') d where coalesce(d->>'designer','')<>'' and ${chartSlotFilter(f)} group by adxc_text_key(d->>'designer') order by count desc,adxc_text_key(d->>'designer') collate "C" limit 20)x),'[]') designers`);
 return r??{tags:[],levels:[],designers:[]};
}
export async function searchPublic(ctx:StorageContext,input:DiscoveryInput):Promise<SearchResult> {
 return snapshot(ctx,async(tx,deadline)=>{
  const groups:SearchResult['groups']={charts:empty(),authors:empty(),lists:empty(),topics:empty()};
  for(const type of input.type==='all'?SEARCH_TYPES:[input.type]){
   groups[type]=await groupSavepoint(tx,type,deadline,()=>queryGroup(tx,type,input.filters,input.cursor,input.type==='all'?4:20))??unavailable();
  }
  if(input.type!=='all'&&groups[input.type].status!=='ready')throw new StorageUnavailableError();
  let facets:SearchFacets|null=null;
  if(input.type==='charts'&&groups.charts.status==='ready')facets=await groupSavepoint(tx,'charts',deadline,()=>queryFacets(tx,input.filters));
  return {type:input.type,query:input.filters.q,groups,facets};
 },{partial:input.type==='all'});
}
export async function suggestPublic(ctx:StorageContext,q:string):Promise<SearchHit[]> {
 if(!normalizeSearchText(q))return [];
 const f=parsePublicChartFilters({q,sort:'relevance'});
 return snapshot(ctx,async tx=>(await queryGroup(tx,'charts',f,undefined,6)).items);
}
export async function catalogPublic(ctx:StorageContext,input:PublicChartSearchInput&{cursor?:string;limit?:number}={}):Promise<PublicChartsPageDto> {
 let f:PublicChartFilters;try{f=parsePublicChartFilters(input);}catch{throw invalid();}
 if(input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50))throw invalid();
 const limit=Math.min(input.limit??20,20);
 let cursor=input.cursor;
 if(cursor&&cursor.length>1024)throw invalid();
 // Only unfiltered legacy default cursors may cross the old algorithm boundary.
 if(cursor){try{const c=JSON.parse(Buffer.from(cursor,'base64url').toString());if(c&&typeof c.id==='string'&&/^[0-9a-f-]{36}$/i.test(c.id)&&Object.keys(c).sort().join().match(/^(at,id|at,id,scope)$/)&&!f.q&&!f.author&&!f.tag&&!f.tags&&!f.difficulty&&!f.levels&&!f.designer&&!f.preview&&f.minSeconds===undefined&&f.maxSeconds===undefined&&f.sort==='updated'){
  if(c.scope!==undefined&&c.scope!==key(f))throw invalid();if(new Date(c.at).toISOString()!==c.at)throw invalid();
  const [r]=await rows<{n:string}>(ctx.db,sql`select public_id::text n from chart_public_ids where chart_id=${c.id}::uuid`);if(!r)throw invalid();
  cursor=encodeCursor({scope:key({algorithm:1,type:'charts',f:{...f,q:normalizeSearchText(f.q)}}),score:0,at:c.at,id:r.n,title:''});
 }}catch{throw invalid();}}
 // The legacy catalog keeps its existing 400 contract; new search uses 409 for stale scope.
 if(cursor){try{decodeCursor(cursor,key({algorithm:1,type:'charts',f:{...f,q:normalizeSearchText(f.q)}}));}catch{throw invalid();}}
 return snapshot(ctx,async(tx,deadline)=>{const p=await queryGroup(tx,'charts',f,cursor,limit);const facets=input.limit===undefined?await groupSavepoint(tx,'charts',deadline,()=>queryFacets(tx,f)):null;return {items:p.items.map(h=>h.chart!),nextCursor:p.nextCursor,total:p.total,facets};});
}
