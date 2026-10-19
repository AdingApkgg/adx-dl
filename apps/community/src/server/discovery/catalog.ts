import performanceVerification from "./verification.json";
import {createHash,randomInt} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {normalizeSearchText,type AuthorSummary,type DirectoryPage,type SearchFacets,type DiscoveryPage} from '@/shared/discovery-search';
import {parsePublicChartFilters,type PublicChartSearchInput} from '@/shared/public-chart-search';
import {isPublicChartId} from '@/shared/chart-public-id';
import type {PublicChartDto} from '@/shared/charts';
import type {PublicListSummary} from '@/shared/library';
import type {StorageContext} from '../storage/contracts';
import {StorageError,StorageUnavailableError} from '../storage/errors';
import {chartRelation,listRelation} from './visibility';
import {snapshot,groupSavepoint,rows,key,chartFilter,termMatch,invalid} from './query';
import {queryGroup,unavailable} from './search';
export async function tagPageIn(ctx:StorageContext,input:{q?:string;cursor?:string;limit?:number}={}):Promise<DirectoryPage<SearchFacets['tags'][number]>> {
 const q=normalizeSearchText(input.q??'');if([...q].length>20||/[\p{Cc}\uD800-\uDFFF]/u.test(q))throw invalid();
 const scope=key({kind:'tags',q});let c:{scope:string;count:number;key:string}|undefined;
 if(input.cursor){try{if(input.cursor.length>1024)throw 0;c=JSON.parse(Buffer.from(input.cursor,'base64url').toString());if(!c||Object.keys(c).sort().join()!=='count,key,scope'||c.scope!==scope||!Number.isSafeInteger(c.count)||c.count<0||typeof c.key!=='string'||[...c.key].length>20)throw 0;}catch{throw invalid();}}
 const limit=Math.min(input.limit??20,20);
 const rr=await rows<{key:string;label:string;count:number}>(ctx.db,sql`with tags as(select t->>'key' key,min(t->>'label' collate "C") label,count(distinct c.public_id)::integer count from (${chartRelation(ctx)}) c cross join lateral jsonb_array_elements(c.data->'tags') t where strpos(t->>'key',${q})>0 group by t->>'key')
 select * from tags where ${c?sql`(count<${c.count} or (count=${c.count} and key collate "C">${c.key} collate "C"))`:sql`true`} order by count desc,key collate "C" limit ${limit+1}`);
 const items=rr.slice(0,limit),last=items.at(-1);return {items,nextCursor:rr.length>limit&&last?Buffer.from(JSON.stringify({...last,label:undefined,scope})).toString('base64url'):null};
}
export const tagDirectory=(ctx:StorageContext,input:{q?:string;cursor?:string}={})=>snapshot(ctx,tx=>tagPageIn(tx,input));
export async function authorDirectory(ctx:StorageContext,input:{q?:string;cursor?:string;sort?:string}={}):Promise<DirectoryPage<AuthorSummary>> {
 if(input.sort&&input.sort!=='name'&&input.sort!=='recent')throw invalid();
 const f=parsePublicChartFilters({q:input.q,sort:input.sort==='recent'?'updated':'title'});
 return snapshot(ctx,async tx=>{const g=await queryGroup(tx,'authors',f,input.cursor);return {items:g.items.map(h=>({publicId:h.publicId,name:h.title,bio:h.description,image:h.image??null,count:h.count??0,updatedAt:h.updatedAt})),nextCursor:g.nextCursor};});
}
async function randomIn(ctx:StorageContext,input:PublicChartSearchInput={},date?:string):Promise<PublicChartDto|null> {
 const f=parsePublicChartFilters({...input,preview:'1'});
 const eligible=await rows<{data:PublicChartDto;public_id:string}>(ctx.db,sql`select c.public_id,c.data from (${chartRelation(ctx)}) c where ${chartFilter(f)} and ${termMatch(f.q)} order by c.public_id::bigint desc limit 200`);
 if(!eligible.length)return null;
 if(date){eligible.sort((a,b)=>createHash('sha256').update(`${date}/${a.public_id}`).digest('hex').localeCompare(createHash('sha256').update(`${date}/${b.public_id}`).digest('hex')));return eligible[0].data;}
 return eligible[randomInt(eligible.length)].data;
}
export const randomPublicChart=(ctx:StorageContext,input:PublicChartSearchInput={})=>snapshot(ctx,tx=>randomIn(tx,input));
export async function containingPublicLists(ctx:StorageContext,id:string):Promise<PublicListSummary[]> {
 if(!isPublicChartId(id))throw invalid();
 return snapshot(ctx,async tx=>{
 const [chart]=await rows<{id:string}>(tx.db,sql`select c.id from (${chartRelation(tx)}) c where c.public_id=${id}`);if(!chart)throw new StorageError(404,'NOT_FOUND');
 const result=await rows<{data:PublicListSummary}>(tx.db,sql`select c.data from (${listRelation()}) c join chart_lists l on l.id::text=c.id where l.fact->'publication'->'chartIds' @> ${JSON.stringify([chart.id])}::jsonb order by c.at desc,c.public_id::bigint asc limit 6`);return result.map(r=>r.data);
 });
}
export async function discoverPublic(ctx:StorageContext):Promise<DiscoveryPage> {
 return snapshot(ctx,async(tx,deadline)=>{
 const collected=await groupSavepoint(tx,'charts',deadline,()=>queryGroup(tx,'charts',parsePublicChartFilters({sort:'collected'}),undefined,8))??unavailable();
 const updated=await groupSavepoint(tx,'charts',deadline,()=>queryGroup(tx,'charts',parsePublicChartFilters(),undefined,8))??unavailable();
 const lists=await groupSavepoint(tx,'lists',deadline,()=>queryGroup(tx,'lists',parsePublicChartFilters({sort:'published'}),undefined,8))??unavailable();
 const tags=await groupSavepoint(tx,'charts',deadline,()=>tagPageIn(tx,{limit:12}));
 const random=await groupSavepoint(tx,'charts',deadline,()=>randomIn(tx,{},(ctx.now?.()??new Date()).toISOString().slice(0,10)));
 return {collected,updated,lists,tags:{status:tags?'ready':'unavailable',items:tags?.items??[]},daily:random??null,randomAvailable:random!==null};
 });
}
export async function discoveryStatus(ctx:StorageContext) {
 try{const [r]=await rows<{ready:boolean}>(ctx.db,sql`select to_regprocedure('adxc_manifest_valid(jsonb,bigint,text)') is not null and exists(select 1 from information_schema.columns where table_name='chart_publications' and column_name='aliases') ready`);return {ready:!!r?.ready,permissionVersions:[1,2],algorithm:1,performance:performanceVerification};}catch{throw new StorageUnavailableError();}
}
