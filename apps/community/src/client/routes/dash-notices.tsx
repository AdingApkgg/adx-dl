import {useState,type FormEvent} from "react";
import {Link,data,useLocation,useRevalidator} from "react-router";
import {Button} from "@astrodx/ui/components/button";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {ApiError} from "@/shared/api-client";
import {apiContext} from "@/shared/router-context";
import {sameNoticeDraft,type NoticeDraft,type SiteNotice} from "@/shared/community-site";
import {siteApi} from "../queries/community-site";
import {getBrowserApi} from "../lib/browser";
import {requireUser,loginHref} from "../lib/require-user";
import {headers as privateHeaders} from "../lib/dash";
import { DashError, DashViewHeading, DashEmpty } from "../components/dash-ui";
import {PrivateDiscussionGuard} from "../components/discussion-ui";
import type {Route} from "./+types/dash-notices";
export {headers,shouldRevalidate} from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){const me=await requireUser(context,url);try{return data({userId:me.id,page:await siteApi(context.get(apiContext)).adminNotices(url.searchParams.get("cursor")??undefined)},{headers:privateHeaders()});}catch(e){throw data(null,{status:e instanceof ApiError?e.status:503,headers:privateHeaders()});}}
const empty=():NoticeDraft=>({title:{zh:""},body:{zh:""},level:"normal",startsAt:null,expiresAt:null,href:null,linkLabel:null,order:0});
export default function Notices({loaderData}:Route.ComponentProps){return <PrivateDiscussionGuard userId={loaderData.userId} admin><NoticesContent key={loaderData.userId} page={loaderData.page}/></PrivateDiscussionGuard>;}
function NoticesContent({page}:{page:Route.ComponentProps["loaderData"]["page"]}){const [newId,setNewId]=useState<string|null>(null);return <section className="space-y-5"><DashViewHeading title={m.site_notices()} description={m.site_notice_draft_hint()} count={page.items.length} /><Button onClick={()=>setNewId(crypto.randomUUID())}>{m.site_notice_new()}</Button>{newId?<NoticeEditor key={newId} row={page.items.find(row=>row.id===newId)??{id:newId,revision:0,draft:empty(),publication:null,withdrawn:false}}/>:null}
 <ul className="space-y-4">{page.items.filter(row=>row.id!==newId).map(row=><li key={row.id}><NoticeEditor key={row.id} row={row}/></li>)}</ul>{!page.items.length&&!newId?<DashEmpty/>:null}
 {page.nextCursor?<Link className="underline" to={`${localizeHref("/dash/notices")}?cursor=${encodeURIComponent(page.nextCursor)}`}>{m.chart_next()}</Link>:null}</section>;}
function NoticeEditor({row}:{row:SiteNotice}){
 const [draft,setDraft]=useState(row.draft),[revision,setRevision]=useState(row.revision),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(row),[latest,setLatest]=useState<SiteNotice|null>(null);
 const revalidator=useRevalidator(),location=useLocation();
 async function mutate(action:"save"|"publish"|"withdraw"){
  if(pending||(action!=="save"&&!confirmed))return;setPending(true);setError(undefined);
  try{const next=await siteApi(getBrowserApi()).saveNotice(row.id,{expectedRevision:revision,action,...(action==="save"?{draft}:{}),confirm:true});setSaved(next);setLatest(null);setRevision(next.revision);setConfirmed(false);await revalidator.revalidate();}
  catch(failure){setError(failure);try{setLatest(await siteApi(getBrowserApi()).getNotice(row.id));}catch{}await revalidator.revalidate();}finally{setPending(false);}
 }
 function translated(field:"title"|"body",lang:"zh"|"en"|"ja",value:string){setDraft(current=>({...current,[field]:{...current[field],[lang]:value}}));setConfirmed(false);}
 const dirty=!sameNoticeDraft(draft,saved.draft);
 const server=latest&&latest.revision>=row.revision?latest:row;
 const conflict=server.revision>revision;
 const disabled=pending||saved.withdrawn||server.withdrawn;
 return <form className="space-y-3 rounded-xl border p-4" onSubmit={(event:FormEvent)=>{event.preventDefault();void mutate("save");}}>
  <p className="text-sm">{saved.withdrawn?m.site_notice_withdrawn():saved.publicationPending?m.site_notice_pending():saved.publication?m.site_notice_published():m.site_notice_draft()}</p>
  {(["zh","en","ja"] as const).map(lang=><details key={lang} open={lang==="zh"}><summary className="cursor-pointer py-2">{lang.toUpperCase()}</summary><label className="block">{m.site_notice_title()}<input className="mt-1 block min-h-11 w-full rounded border bg-background p-2" value={draft.title[lang]??""} maxLength={160} disabled={disabled} onChange={e=>translated("title",lang,e.target.value)}/></label><label className="block">{m.site_notice_body()}<textarea className="mt-1 block min-h-32 w-full rounded border bg-background p-2" value={draft.body[lang]??""} maxLength={4000} disabled={disabled} onChange={e=>translated("body",lang,e.target.value)}/></label></details>)}
  <label className="block">{m.site_notice_level()}<select className="ml-2 min-h-11 rounded border bg-background px-2" value={draft.level} disabled={disabled} onChange={e=>setDraft({...draft,level:e.target.value as "normal"|"important"})}><option value="normal">{m.site_normal()}</option><option value="important">{m.site_important()}</option></select></label>
  <label className="block">{m.site_notice_order()}<input className="ml-2 min-h-11 rounded border bg-background p-2" type="number" min={0} max={1000} value={draft.order} disabled={disabled} onChange={e=>setDraft({...draft,order:Number(e.target.value)})}/></label>
  <div className="grid gap-3 sm:grid-cols-2">{(["startsAt","expiresAt"] as const).map(field=><label key={field}>{field==="startsAt"?m.site_notice_start():m.site_notice_end()} (UTC)<input className="block min-h-11 w-full rounded border bg-background p-2" type="datetime-local" value={draft[field]?.slice(0,16)??""} disabled={disabled} onChange={e=>setDraft({...draft,[field]:e.target.value?new Date(e.target.value+"Z").toISOString():null})}/></label>)}</div>
  <label className="block">{m.site_notice_link()}<input className="mt-1 block min-h-11 w-full rounded border bg-background p-2" value={draft.href??""} disabled={disabled} maxLength={300} onChange={e=>setDraft({...draft,href:e.target.value||null,linkLabel:e.target.value?(draft.linkLabel??{zh:m.site_view()}):null})}/></label>
  {draft.href?<div className="grid gap-3 sm:grid-cols-3">{(["zh","en","ja"] as const).map(lang=><label key={lang} className="block">{m.site_notice_link_label()} ({lang.toUpperCase()})<input className="mt-1 block min-h-11 w-full rounded border bg-background p-2" value={draft.linkLabel?.[lang]??""} disabled={disabled} maxLength={160} onChange={e=>{setDraft({...draft,linkLabel:{zh:"",...draft.linkLabel,[lang]:e.target.value}});setConfirmed(false);}}/></label>)}</div>:null}
  <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={disabled}>{m.site_save_draft()}</Button><label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={disabled}/>{m.site_confirm()}</label><Button type="button" disabled={disabled||revision===0||!confirmed||dirty||conflict} onClick={()=>void mutate("publish")}>{m.site_publish_saved()}</Button><Button type="button" variant="outline" disabled={disabled||!saved.publication||!confirmed} onClick={()=>void mutate("withdraw")}>{m.site_withdraw()}</Button></div>
  {dirty?<p className="text-sm">{m.site_notice_save_first()}</p>:null}
  {conflict?<div role="alert" className="space-y-2"><p>{m.site_changed()}</p><details><summary>{m.site_server_version()}</summary><p className="whitespace-pre-wrap">{server.draft.title.zh}{"\n"}{server.draft.body.zh}</p></details><Button type="button" variant="outline" onClick={()=>{setRevision(server.revision);setSaved(server);setLatest(null);setConfirmed(false);}}>{m.site_keep_input()}</Button></div>:null}
  {error?<div role="alert"><p>{error instanceof ApiError&&error.code==="SITE_CHANGED"?m.site_changed():m.site_error()}</p>{error instanceof ApiError&&error.code==="REAUTH_REQUIRED"?<Link className="underline" to={loginHref(location.pathname+location.search,{reauth:"1"})}>{m.site_reauth()}</Link>:null}</div>:null}
 </form>;
}
export const ErrorBoundary=DashError;
