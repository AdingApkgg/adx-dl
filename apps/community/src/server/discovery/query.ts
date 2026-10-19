import {createHash} from 'node:crypto';
import {sql,type SQL} from 'drizzle-orm';
import {HTTPException} from 'hono/http-exception';
import type {StorageContext} from '../storage/contracts';
import {StorageUnavailableError} from '../storage/errors';
import {rows} from '../discussions/core';
import type {PublicChartFilters} from '@/shared/public-chart-search';
import {normalizeSearchText,searchTerms,type SearchType} from '@/shared/discovery-search';
export const invalid=()=>new HTTPException(400,{message:'Invalid public search'});
export const key=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Cursor={scope:string;score:number;at:string;id:string;title:string};
export function decodeCursor(value:string|undefined,scope:string):Cursor|null {
 if(!value)return null;
 try{if(value.length>1024||!/^[\w-]+$/.test(value))throw 0;const c=JSON.parse(Buffer.from(value,'base64url').toString());
 if(Object.keys(c).sort().join()!=='at,id,scope,score,title'||c.scope!==scope||!Number.isSafeInteger(c.score)||c.score<0||c.score>7||typeof c.id!=='string'||!/^[1-9]\d{0,18}$/.test(c.id)||BigInt(c.id)>9223372036854775807n||new Date(c.at).toISOString()!==c.at||typeof c.title!=='string'||c.title.length>512)throw 0;
 return c;}catch{throw new HTTPException(409,{message:'Search changed; refresh results'});}
}
export function encodeCursor(c:Cursor):string{return Buffer.from(JSON.stringify(c)).toString('base64url');}
/** Known static column expressions only. No untrusted identifier enters sql.raw. */
export function chartSlotFilter(f:PublicChartFilters):SQL {
 return sql`(${f.difficulty??null}::integer is null or (d->>'difficulty')::integer=${f.difficulty??null}) and
 (${!f.levels?.length} or adxc_text_key(d->>'level')=any(${f.levels??[]}::text[])) and
 (${!f.designer} or adxc_text_key(d->>'designer')=adxc_text_key(${f.designer??''})) and
 (${f.minSeconds===undefined} or (d->>'durationMs')::integer>=${(f.minSeconds??0)*1000}) and
 (${f.maxSeconds===undefined} or (d->>'durationMs')::integer<=${(f.maxSeconds??3600)*1000}) and
 (${!f.preview} or (d->>'previewSupported')::boolean and (d->>'noteCount')::integer>0)`;
}
export function chartFilter(f:PublicChartFilters):SQL {
 const tags=f.tags??(f.tag?[f.tag]:[]);
 const slot=(f.difficulty||f.levels?.length||f.designer||f.minSeconds!==undefined||f.maxSeconds!==undefined||f.preview)?sql`exists(select 1 from jsonb_array_elements(c.data->'summary'->'difficulties') d where ${chartSlotFilter(f)})`:sql`true`;
 return sql`${slot} and (${!f.author} or c.data->'author'->>'publicId'=${f.author??''}) and ${tags.length?sql.join(tags.map(t=>sql`c.data->'tags' @> ${JSON.stringify([{key:t}])}::jsonb`),sql` and `):sql`true`}`;
}
export function termMatch(q:string):SQL {
 const terms=searchTerms(q);return terms.length?sql.join(terms.map(term=>sql`exists(select 1 from jsonb_array_elements(c.fields) f where (f->>'kind'='id' and f->>'value'=${term}) or (f->>'kind'<>'id' and strpos(adxc_text_key(f->>'value'),${term})>0))`),sql` and `):sql`true`;
}
export function rankSelect(q:string):SQL {
 const n=normalizeSearchText(q),terms=searchTerms(q);
 return sql`select f->>'kind' kind,left(f->>'value',120) label,case
 when ${n}='' then 0
 when f->>'kind'='id' and f->>'value'=${n} then 7
 when f->>'kind'='title' and adxc_text_key(f->>'value')=${n} then 6
 when f->>'kind' in('title','alias') and strpos(adxc_text_key(f->>'value'),${n})=1 then 5
 when f->>'kind' in('title','alias') and strpos(adxc_text_key(f->>'value'),${n})>0 then 4
 when f->>'kind'<>'id' and exists(select 1 from unnest(${terms}::text[]) term where strpos(adxc_text_key(f->>'value'),term)>0) then case when f->>'kind'='body' then 2 else 3 end
 else 0 end::integer score from jsonb_array_elements(c.fields) with ordinality f0(f,ord) order by score desc,ord limit 1`;
}
export function orderBy(f:PublicChartFilters):SQL {
 if(f.sort==='collected')return sql`public_id::bigint desc`;
 if(f.sort==='title')return sql`adxc_text_key(title) collate "C" asc,public_id::bigint asc`;
 return f.sort==='relevance'?sql`score desc,at desc,public_id::bigint asc`:sql`at desc,public_id::bigint asc`;
}
export function afterCursor(f:PublicChartFilters,c:Cursor|null):SQL {
 if(!c)return sql`true`;
 if(f.sort==='collected')return sql`public_id::bigint<${c.id}::bigint`;
 if(f.sort==='title')return sql`(adxc_text_key(title) collate "C",public_id::bigint)>(${c.title} collate "C",${c.id}::bigint)`;
 const tail=sql`(at<${c.at}::timestamptz or (at=${c.at}::timestamptz and public_id::bigint>${c.id}::bigint))`;
 return f.sort==='relevance'?sql`(score<${c.score} or (score=${c.score} and ${tail}))`:tail;
}
export async function snapshot<T>(ctx:StorageContext,run:(ctx:StorageContext,deadline:number)=>Promise<T>):Promise<T>{
 const deadline=performance.now()+2500;
 try{return await ctx.db.transaction(async tx=>{if(performance.now()>=deadline)throw new StorageUnavailableError();await tx.execute(sql`set local statement_timeout='1500ms'`);const r=await run({...ctx,db:tx as unknown as StorageContext['db']},deadline);if(performance.now()>deadline)throw new StorageUnavailableError();return r;},{isolationLevel:'repeatable read',accessMode:'read only'});}catch(e){if(e instanceof HTTPException)throw e;if(e instanceof RangeError)throw invalid();throw new StorageUnavailableError();}
}
export async function groupSavepoint<T>(ctx:StorageContext,type:SearchType,deadline:number,run:()=>Promise<T>):Promise<T|null>{
 if(performance.now()>=deadline)return null;
 // Names are selected from the static entity union; all operations use the same connection/snapshot.
 const name=sql.raw('search_'+type);
 await ctx.db.execute(sql`savepoint ${name}`);
 try{await ctx.db.execute(sql`select set_config('statement_timeout',${String(Math.max(1,Math.min(1500,Math.floor(deadline-performance.now()))))},true)`);const r=await run();await ctx.db.execute(sql`release savepoint ${name}`);return r;}
 catch(e){await ctx.db.execute(sql`rollback to savepoint ${name}`);await ctx.db.execute(sql`release savepoint ${name}`);if(e instanceof HTTPException)throw e;return null;}
}
export {rows};
