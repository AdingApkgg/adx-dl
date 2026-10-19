import {sql,type SQL} from "drizzle-orm";
import {HTTPException} from "hono/http-exception";
import type {Db} from "../db/client";
import type {DbTransaction,StorageContext} from "../storage/contracts";
import {withStorageTransaction} from "../storage/transactions";
import {StorageError,StorageUnavailableError} from "../storage/errors";
import {rows,exported} from "../discussions/core";
import {socialPage} from "../services/social-page";
import {getPublicChartsByIds} from "../charts/publication";
import {libraryId,libraryPublicId,type LibraryEntry} from "@/shared/library";
import {privateLibraryFact,type PrivateListFact,type LibraryControlFact} from "@/shared/private-library-journal";
export {rows,exported};
export type Handle=Db|DbTransaction;
export type ListRow={id:string;owner_id:string;revision:number;public_id:string|null;fact:PrivateListFact;journal_sequence:number;updated_at:Date;published_at:Date|null};
export const missing=()=>new StorageError(404,"NOT_FOUND");
export const changed=()=>new StorageError(409,"LIBRARY_CHANGED");
export const limited=()=>new StorageError(409,"LIBRARY_LIMIT");
export const txContext=(ctx:StorageContext,tx:Handle):StorageContext=>({...ctx,db:tx as Db});
export async function assertLibraryReady(db:Handle,userId?:string){const [s]=await rows<{ready:boolean}>(db,sql`select ready from chart_library_status where id='global'`);if(!s?.ready)throw new StorageUnavailableError();if(userId){const [pending]=await rows(db,sql`select 1 from chart_library_states where journal_sequence>${exported} and (fact->>'userId'=${userId} or fact->>'id'=${userId}) limit 1`);if(pending)throw new StorageUnavailableError();}}
export async function accountCutoff(db:Handle,userId:string){const [r]=await rows<{sequence:number}>(db,sql`select coalesce((select journal_sequence from chart_library_accounts where user_id=${userId}),0) sequence`);return Number(r.sequence);}
export async function listRow(db:Handle,id:string,lock=false){if(!libraryId.safeParse(id).success)throw missing();const [r]=await rows<ListRow>(db,sql`select * from chart_lists where id=${id}::uuid ${lock?sql`for update`:sql``}`);if(!r)throw missing();r.fact=privateLibraryFact.parse(r.fact) as PrivateListFact;return r;}
export async function controlRow(db:Handle,id:string){const [r]=await rows<{fact:LibraryControlFact;journal_sequence:number}>(db,sql`select fact,journal_sequence from chart_list_controls where id=${id}::uuid`);return r??null;}
export async function libraryTransaction<T>(ctx:StorageContext,actorId:string,ownerId:string,run:(tx:DbTransaction)=>Promise<T>){return withStorageTransaction(ctx.db,async tx=>{const accounts=await rows<{id:string;status:string}>(tx,sql`select id,status from "user" where id in(${actorId},${ownerId}) order by id for update`);if(accounts.find(a=>a.id===actorId)?.status!=="active")throw new HTTPException(403);await assertLibraryReady(tx);return run(tx);});}
/** All public queries, including search/count and moderation restore, use this same gate. */
export function publicListAllowed(alias="l"):SQL{const a=sql.raw(alias);return sql`adxc_library_public_valid(${a}.fact,${a}.public_id::text) and exists(select 1 from chart_library_status where id='global' and ready)
 and exists(select 1 from "user" u where u.id=${a}.owner_id and u.status='active')
 and ${a}.fact->'deleted'='false'::jsonb and ${a}.fact->'publication' is not null and ${a}.fact->'publication'<>'null'::jsonb
 and ${a}.journal_sequence<=${exported}
 and (case when adxc_jint(${a}.fact->'publication'->'ownerCutoff',0,9007199254740991) then (${a}.fact->'publication'->>'ownerCutoff')::bigint else -1 end)=coalesce((select journal_sequence from chart_library_accounts where user_id=${a}.owner_id),0)
 and not exists(select 1 from chart_list_controls ctl where ctl.id=${a}.id and (ctl.fact->'hidden' is distinct from 'false'::jsonb or ctl.journal_sequence>${exported}))
 and exists(select 1 from chart_library_states st where st.key='list:'||${a}.id::text and st.fact=${a}.fact and st.revision=${a}.revision and st.journal_sequence=${a}.journal_sequence)
 and exists(select 1 from chart_list_public_ids li where li.list_id=${a}.id and li.public_id=${a}.public_id)

 and exists(select 1 from user_public_ids p where p.user_id=${a}.owner_id and p.journal_sequence<=${exported})`;}
export async function chartEntries(ctx:StorageContext,ids:readonly string[]):Promise<LibraryEntry[]>{if(!ids.length)return [];const charts=await getPublicChartsByIds(ctx,ids),byId=new Map(charts.map(c=>[c.id,c]));const identities=await rows<{chart_id:string;public_id:string}>(ctx.db,sql`select chart_id,public_id::text from chart_public_ids where chart_id in(${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);const numbers=new Map(identities.map(i=>[i.chart_id,i.public_id]));return ids.map(id=>({id,publicId:numbers.get(id)??null,chart:byId.get(id)??null}));}
/** Existing unavailable entries may be retained/removed; every newly added ID must be public now. */
export async function resolveInputEntries(ctx:StorageContext,values:string[],existing:readonly string[]=[]){if(values.length>200||new Set(values).size!==values.length)throw limited();const numeric=values.filter(v=>!libraryId.safeParse(v).success);if(numeric.some(v=>!libraryPublicId.safeParse(v).success))throw new HTTPException(400);const numbers=numeric.length?await rows<{chart_id:string;public_id:string}>(ctx.db,sql`select chart_id,public_id::text from chart_public_ids where public_id in(${sql.join(numeric.map(v=>sql`${v}::bigint`),sql`,`)})`):[];const map=new Map(numbers.map(r=>[r.public_id,r.chart_id]));const ids=values.map(v=>libraryId.safeParse(v).success?v:map.get(v));if(ids.some(v=>!v))throw new StorageError(409,"LIBRARY_ENTRIES_UNAVAILABLE");const resolved=ids as string[];if(new Set(resolved).size!==resolved.length)throw limited();const added=resolved.filter(id=>!existing.includes(id)),ok=await chartEntries(ctx,added);if(ok.some(i=>!i.chart))throw new StorageError(409,"LIBRARY_ENTRIES_UNAVAILABLE");return resolved;}

export function listPage(cursor:string|undefined,scope:string){const p=socialPage({cursor,limit:20},scope);return {...p,condition:(at:SQL,id:SQL)=>p.cursor?sql`(${at},${id})<(${p.cursor.at}::timestamptz,${p.cursor.id}::uuid)`:sql`true`};}
