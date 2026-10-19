import {sql} from "drizzle-orm";
import {HTTPException} from "hono/http-exception";
import {libraryDraft,type LibraryList,type LibrarySummary,type SaveLibraryInput} from "@/shared/library";
import type {PrivateListFact} from "@/shared/private-library-journal";
import type {StorageContext,DbTransaction} from "../storage/contracts";
import {communityHash} from "../community/content-journal";
import {requireActiveSocialUser} from "../services/social-page";
import {rows,publicListAllowed,assertLibraryReady,accountCutoff,listRow,controlRow,libraryTransaction,txContext,chartEntries,resolveInputEntries,listPage,missing,changed,limited} from "./core";
import {recordLibraryFact,awaitLibraryJournal} from "./journal";
const now=async(tx:DbTransaction)=>{const [r]=await rows<{at:Date}>(tx,sql`select clock_timestamp() at`);return new Date(r.at).toISOString();};
export async function getPrivateList(ctx:StorageContext,userId:string,id:string):Promise<LibraryList>{await requireActiveSocialUser(ctx.db,userId);await assertLibraryReady(ctx.db,userId);const r=await listRow(ctx.db,id);if(r.owner_id!==userId||r.fact.deleted||!r.fact.draft)throw missing();const control=await controlRow(ctx.db,id),f=r.fact,p=f.publication;const [available]=await rows(ctx.db,sql`select 1 from chart_lists l where l.id=${id}::uuid and ${publicListAllowed()}`);return {id:f.id,publicId:f.publicId,revision:f.revision,name:f.draft!.name,description:f.draft!.description,entries:await chartEntries(ctx,f.draft!.chartIds),publiclyAvailable:!!available,publication:p?{name:p.name,description:p.description,revision:p.revision,publishedAt:p.publishedAt,entries:await chartEntries(ctx,p.chartIds)}:null,moderation:control?{revision:control.fact.revision,hidden:control.fact.hidden,reason:control.fact.reason}:null,createdAt:f.createdAt,updatedAt:f.updatedAt};}
export async function listPrivateLists(ctx:StorageContext,userId:string,cursor?:string){await requireActiveSocialUser(ctx.db,userId);await assertLibraryReady(ctx.db,userId);const p=listPage(cursor,`library:${userId}`),rr=await rows<ListRow>(ctx.db,sql`select * from chart_lists l where owner_id=${userId} and not (fact->>'deleted')::boolean and ${p.condition(sql`updated_at`,sql`id`)} order by updated_at desc,id desc limit 21`);const selected=rr.slice(0,20),last=selected.at(-1);return {items:selected.map(r=>({id:r.id,publicId:r.fact.publicId,revision:r.revision,name:r.fact.draft!.name,description:r.fact.draft!.description,updatedAt:r.fact.updatedAt,count:r.fact.draft!.chartIds.length,published:!!r.fact.publication} satisfies LibrarySummary)),nextCursor:rr.length>20&&last?p.encode(new Date(last.updated_at),last.id):null};}
import type {ListRow} from "./core";
export async function saveListInTransaction(ctx:StorageContext,tx:DbTransaction,userId:string,input:SaveLibraryInput){let r:ListRow|null=null;try{r=await listRow(tx,input.id,true);}catch(e){if(!(e instanceof Error)||!("status" in e)||e.status!==404)throw e;}
 if(r&&(r.owner_id!==userId||r.fact.deleted))throw missing();if(!r&&input.expectedRevision!==0)throw changed();
 const chartIds=await resolveInputEntries(txContext(ctx,tx),input.entries,r?.fact.draft?.chartIds),draft=libraryDraft.parse({name:input.name,description:input.description,chartIds});
 if(r&&communityHash(r.fact.draft)===communityHash(draft))return Number(r.journal_sequence);
 if(r&&r.revision!==input.expectedRevision)throw changed();if(!r){const [n]=await rows<{n:number}>(tx,sql`select count(*)::int n from chart_lists where owner_id=${userId} and not (fact->>'deleted')::boolean`);if(n.n>=100)throw limited();}
 const at=await now(tx),fact:PrivateListFact={version:1,entity:"list",id:input.id,userId,revision:(r?.revision??0)+1,publicId:r?.fact.publicId??null,draft,publication:r?.fact.publication??null,deleted:false,createdAt:r?.fact.createdAt??at,updatedAt:at};return recordLibraryFact(tx,fact);
}
export async function saveList(ctx:StorageContext,userId:string,input:SaveLibraryInput){const sequence=await libraryTransaction(ctx,userId,userId,tx=>saveListInTransaction(ctx,tx,userId,input));await awaitLibraryJournal(ctx,sequence);return getPrivateList(ctx,userId,input.id);}
export async function changeListPublication(ctx:StorageContext,userId:string,id:string,expectedRevision:number,action:"publish"|"withdraw"|"delete"){const sequence=await libraryTransaction(ctx,userId,userId,async tx=>{const r=await listRow(tx,id,true);if(r.owner_id!==userId)throw missing();const f=r.fact;if(f.deleted){if(action==="delete")return Number(r.journal_sequence);throw missing();}
 if(action==="withdraw"&&!f.publication)return Number(r.journal_sequence);
 const cutoff=await accountCutoff(tx,userId);
 if(action==="publish"&&f.publication&&f.publication.revision===f.revision&&f.publication.ownerCutoff===cutoff&&f.revision===expectedRevision+1)return Number(r.journal_sequence);
 if(r.revision!==expectedRevision)throw changed();const at=await now(tx);f.revision++;f.updatedAt=at;
 if(action==="delete"){f.deleted=true;f.draft=null;f.publication=null;}
 else if(action==="withdraw")f.publication=null;
 else {const control=await controlRow(tx,id);if(control?.fact.hidden)throw new StorageError(409,"LIBRARY_MODERATED");if(!f.draft?.chartIds.length)throw new HTTPException(400);const entries=await chartEntries(txContext(ctx,tx),f.draft.chartIds);if(entries.some(e=>!e.chart))throw new StorageError(409,"LIBRARY_ENTRIES_UNAVAILABLE");if(!f.publicId){const [n]=await rows<{id:string}>(tx,sql`select nextval('chart_list_public_id_seq')::text id`);f.publicId=n.id;}f.publication={...f.draft,revision:f.revision,publicId:f.publicId,publishedAt:at,ownerCutoff:cutoff};}
 return recordLibraryFact(tx,f);});await awaitLibraryJournal(ctx,sequence);return action==="delete"?{ok:true as const}:getPrivateList(ctx,userId,id);}
import {StorageError} from "../storage/errors";
