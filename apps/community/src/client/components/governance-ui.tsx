import { Button } from "@astrodx/ui/components/button";
import { Textarea } from "@astrodx/ui/components/textarea";
import { useState } from "react";
import { Form, Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { GovernanceAppeal, GovernanceDecision } from "@/shared/governance";
import { getBrowserApi } from "../lib/browser";
import { governanceError } from "../lib/governance";
import { dashDate } from "../lib/dash";
import { governanceApi } from "../queries/governance";
import { useDiscussionLocalDraft, useDiscussionTask } from "./discussion-ui";
export const governanceStatus=(status:string)=>({open:m.governance_open,upheld:m.governance_upheld,review_required:m.governance_review_required,dismissed:m.report_dismissed,actioned:m.report_actioned} as Record<string,()=>string>)[status]?.()??m.dash_unknown();
export const governanceSourceName=(source:string)=>({chart:m.governance_source_chart,discussion:m.governance_source_discussion,list:m.governance_source_list} as Record<string,()=>string>)[source]?.()??m.dash_unknown();
export const governanceKindName=(kind:string)=>({moderation:m.governance_kind_moderation,report_resolution:m.governance_kind_report,notice:m.site_notices,featured:m.site_featured,appeal_resolution:m.governance_kind_appeal} as Record<string,()=>string>)[kind]?.()??m.dash_unknown();
export const governanceAction=(action:string)=>({hide:m.governance_action_hide,lock:m.governance_action_lock,unlock:m.governance_action_unlock,pin:m.governance_action_pin,unpin:m.governance_action_unpin,move:m.governance_action_move,update:m.governance_action_update,restore:m.governance_action_restore,save:m.governance_action_save,publish:m.governance_action_publish,withdraw:m.governance_action_withdraw,upheld:m.governance_upheld,review_required:m.governance_review_required,dismissed:m.report_dismissed,actioned:m.report_actioned} as Record<string,()=>string>)[action]?.()??m.dash_unknown();
export function GovernanceNavigation({view}:{view:"decisions"|"appeals"|"reports"}) {
 const items=[{key:"decisions",href:"/me/governance",label:m.governance_decisions()},{key:"appeals",href:"/me/governance?view=appeals",label:m.governance_my_appeals()},{key:"reports",href:"/me/reports",label:m.ui_chart_reports()}];
 return <nav className="community-content-nav" aria-label={m.ui_case_navigation()}>{items.map(item=><Link key={item.key} to={localizeHref(item.href)} aria-current={view===item.key?"page":undefined}>{item.label}</Link>)}</nav>;
}
export function GovernanceFilters({source=false,kind=false}:{source?:boolean;kind?:boolean}){
 const location=useLocation(),params=new URLSearchParams(location.search);
 return <Form method="get" key={location.search} className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
 {kind?<label className="grid gap-1 text-sm">{m.governance_kind()}<select className="min-h-11 rounded border bg-background px-2" name="kind" defaultValue={params.get('kind')??''}><option value="">{m.discussion_all()}</option>{['moderation','report_resolution','notice','featured','appeal_resolution'].map(k=><option key={k} value={k}>{governanceKindName(k)}</option>)}</select></label>:<label className="grid gap-1 text-sm">{m.report_status_filter()}<select className="min-h-11 rounded border bg-background px-2" name="status" defaultValue={params.get('status')??'open'}><option value="open">{m.governance_open()}</option><option value="resolved">{m.report_resolved()}</option><option value="all">{m.discussion_all()}</option></select></label>}
 {source?<label className="grid gap-1 text-sm">{m.governance_source()}<select name="source" defaultValue={params.get('source')??''} className="min-h-11 rounded border bg-background px-2"><option value="">{m.discussion_all()}</option>{['chart','discussion','list'].map(s=><option key={s} value={s}>{governanceSourceName(s)}</option>)}</select></label>:null}<Button>{m.discussion_apply()}</Button>
 </Form>;
}
export function AppealComposer({decision}:{decision:GovernanceDecision}){
 const [form,setForm]=useDiscussionLocalDraft(`appeal:${decision.key}`,()=>({reason:'',confirmed:false}),v=>v.reason.length>0),[done,setDone]=useState(false),task=useDiscussionTask(governanceError),revalidator=useRevalidator();
 const length=[...form.reason.trim()].length;
 if(decision.appealId||done)return <p role="status" className="text-sm">{m.governance_submitted()} <Link className="underline" to={`${localizeHref('/me/governance')}?view=appeals`}>{m.governance_my_appeals()}</Link></p>;
 return <form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(!form.confirmed||length<1||length>1000)return;
 if(await task.run(async()=>{const saved=await governanceApi(getBrowserApi()).create({decisionKey:decision.key,reason:form.reason.trim()});if(saved.decisionKey!==decision.key)throw new Error('Unconfirmed appeal');})){setDone(true);setForm({reason:'',confirmed:false});void revalidator.revalidate();}}}>
 <label className="grid gap-1 text-sm">{m.governance_appeal_reason()}<Textarea value={form.reason} disabled={task.pending} maxLength={2000} onChange={e=>setForm({reason:e.target.value,confirmed:false})}/></label><p className="text-xs text-muted-foreground">{length}/1000 · {m.governance_appeal_limit()}</p>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.confirmed} disabled={task.pending} onChange={e=>setForm(v=>({...v,confirmed:e.target.checked}))}/>{m.governance_confirm()}</label><Button disabled={task.pending||!form.confirmed||length<1||length>1000}>{m.governance_submit()}</Button>{task.feedback}
 </form>;
}
export function AppealReviewForm({appeal}:{appeal:GovernanceAppeal}){
 const [form,setForm]=useDiscussionLocalDraft(`appeal-review:${appeal.id}`,()=>({status:'upheld' as 'upheld'|'review_required',note:'',confirmed:false}),v=>v.note.length>0),task=useDiscussionTask(governanceError),revalidator=useRevalidator(),length=[...form.note.trim()].length;
 if(appeal.status!=='open')return <div className="space-y-2 rounded bg-muted p-3"><p>{governanceStatus(appeal.status)}</p><p className="whitespace-pre-wrap break-words">{appeal.resolutionNote}</p><time dateTime={appeal.resolvedAt??undefined}>{dashDate(appeal.resolvedAt)}</time>{form.note?<p className="whitespace-pre-wrap break-words">{m.discussion_unsent_resolution()} · {form.note}</p>:null}</div>;
 return <form className="space-y-3 rounded border p-3" onSubmit={async e=>{e.preventDefault();if(!form.confirmed||length<1||length>500)return;
 if(await task.run(async()=>{const saved=await governanceApi(getBrowserApi()).resolve(appeal.id,{expectedRevision:appeal.revision,status:form.status,note:form.note.trim()});if(saved.id!==appeal.id||saved.status!==form.status||saved.resolutionNote!==form.note.trim())throw new Error('Unconfirmed resolution');})){setForm(v=>({...v,note:'',confirmed:false}));void revalidator.revalidate();}}}>
 <label className="grid gap-1 text-sm">{m.governance_result()}<select disabled={task.pending} className="min-h-11 rounded border bg-background px-2" value={form.status} onChange={e=>setForm(v=>({...v,status:e.target.value as typeof form.status,confirmed:false}))}><option value="upheld">{m.governance_upheld()}</option><option value="review_required">{m.governance_review_required()}</option></select></label><p className="text-sm text-muted-foreground">{m.governance_no_restore()}</p>
 <label className="grid gap-1 text-sm">{m.governance_resolution_note()}<Textarea disabled={task.pending} maxLength={1000} value={form.note} onChange={e=>setForm(v=>({...v,note:e.target.value,confirmed:false}))}/></label><p className="text-xs">{length}/500</p>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={task.pending} checked={form.confirmed} onChange={e=>setForm(v=>({...v,confirmed:e.target.checked}))}/>{m.governance_resolve_confirm()}</label><Button disabled={task.pending||!form.confirmed||length<1||length>500}>{m.governance_resolve()}</Button>{task.feedback}
 </form>;
}
export function AppealCard({appeal,staff=false}:{appeal:GovernanceAppeal;staff?:boolean}){
 return <article id={`appeal-${appeal.id}`} className="community-panel space-y-4"><p className="break-all text-xs">{m.governance_reference()} · {appeal.decisionKey}</p><p>{governanceStatus(appeal.status)}</p><time className="text-xs" dateTime={appeal.createdAt}>{dashDate(appeal.createdAt)}</time>{appeal.publicReason?<p className="whitespace-pre-wrap break-words text-sm">{appeal.publicReason}</p>:<p className="text-sm text-muted-foreground">{m.governance_decision_unavailable()}</p>}<p className="whitespace-pre-wrap break-words">{appeal.reason}</p>{staff?<AppealReviewForm appeal={appeal}/>:appeal.resolutionNote?<div className="space-y-2 rounded bg-muted p-3"><p>{m.governance_resolution_note()}</p><p className="whitespace-pre-wrap break-words">{appeal.resolutionNote}</p><time className="text-xs" dateTime={appeal.resolvedAt??undefined}>{dashDate(appeal.resolvedAt)}</time></div>:null}</article>;
}
