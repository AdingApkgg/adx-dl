import {DownloadAddButton} from "../components/download-actions";
import {Button} from "@astrodx/ui/components/button";
import {Input} from "@astrodx/ui/components/input";
import {Textarea} from "@astrodx/ui/components/textarea";
import {useRef,useState,useEffect} from "react";
import {Link,useNavigate} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import type {LibraryList} from "@/shared/library";
import {PageTitle,textLinkClass} from "../components/page-title";
import {PrivateDiscussionGuard,DiscussionError,DiscussionDraftBoundary,useUnsavedDiscussion} from "../components/discussion-ui";
import {getRenderApi} from "../lib/browser";
import {socialError} from "../lib/community-social";
import {libraryApi} from "../queries/library";
import {loadLibrary} from "../lib/library";
import type {Route} from "./+types/list-edit";
export {headers,shouldRevalidate} from "../lib/library";
export function loader({context,url,params}:Route.LoaderArgs){return loadLibrary(context,url,api=>params.id==='new'?Promise.resolve(null):api.get(params.id));}
export const meta=()=>[{title:m.library_edit()},{name:'robots',content:'noindex, nofollow'}];
export default function ListEdit({loaderData,params}:Route.ComponentProps){return <PrivateDiscussionGuard userId={loaderData.userId}><DiscussionDraftBoundary><Editor key={`${loaderData.userId}/${params.id}`} initial={loaderData.page}/></DiscussionDraftBoundary></PrivateDiscussionGuard>;}

function Editor({initial}:{initial:LibraryList|null}){
 const api=libraryApi(getRenderApi()),navigate=useNavigate(),id=useRef(initial?.id??null);
 const [saved,setSaved]=useState(initial),[name,setName]=useState(initial?.name??''),[description,setDescription]=useState(initial?.description??''),[entries,setEntries]=useState((initial?.entries??[]).map(e=>({ref:e.id,title:e.chart?.title??m.favorite_unavailable(),publicId:e.publicId}))),[number,setNumber]=useState(''),[numberError,setNumberError]=useState<string|null>(null),[filter,setFilter]=useState(''),[page,setPage]=useState(0),[drag,setDrag]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[preview,setPreview]=useState(false),[deleting,setDeleting]=useState(false),[deleted,setDeleted]=useState(false);
 const signature=JSON.stringify({name,description,entries:entries.map(e=>e.ref)}),baseline=JSON.stringify({name:saved?.name??'',description:saved?.description??'',entries:(saved?.entries??[]).map(e=>e.id)}),dirty=signature!==baseline;
 useUnsavedDiscussion(dirty&&!deleted);
 useEffect(()=>{if(deleted)void navigate(localizeHref("/me/library"));else if(!initial&&saved&&!dirty)void navigate(localizeHref(`/me/lists/${saved.id}`),{replace:true});},[deleted,initial,saved,dirty,navigate]);
 function adopt(list:LibraryList){id.current=list.id;setSaved(list);setName(list.name);setDescription(list.description);setEntries(list.entries.map(e=>({ref:e.id,title:e.chart?.title??m.favorite_unavailable(),publicId:e.publicId})));setPreview(false);}
 async function run(action:'save'|'publish'|'withdraw'|'delete'|'reload'){
  setBusy(true);setError(null);
  try{
   if(action==='save'){id.current??=crypto.randomUUID();const list=await api.save({id:id.current,expectedRevision:saved?.revision??0,name:name.trim(),description:description.trim(),entries:entries.map(e=>e.ref)});adopt(list);}
   else if(saved){if(action==='reload')adopt(await api.get(saved.id));else {const result=await api.change(saved.id,saved.revision,action);if(action==='delete')setDeleted(true);else if('id' in result)adopt(result);}}
  }catch(e){setError(socialError(e));}finally{setBusy(false);}
 }
 function move(from:number,to:number){
  if(busy||!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>=entries.length||to<0||to>=entries.length||from===to)return;
  setEntries(old=>{const next=[...old],[item]=next.splice(from,1);next.splice(to,0,item);return next;});setPreview(false);
 }
 function addNumber(){
  const next=number.trim();
  if(!/^[1-9][0-9]{0,18}$/.test(next)||BigInt(next)>9223372036854775807n){setNumberError(m.ui_library_invalid_number());return;}
  if(entries.some(entry=>entry.publicId===next||entry.ref===next)){setNumberError(m.ui_library_duplicate_number({id:next}));return;}
  if(entries.length>=200){setNumberError(m.library_limit());return;}
  setEntries(old=>[...old,{ref:next,publicId:next,title:`#${next}`}]);setNumber('');setNumberError(null);setPreview(false);
 }
 const shown=entries.map((entry,index)=>({...entry,index})).filter(entry=>`${entry.title} ${entry.publicId??''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
 const lastPage=Math.max(0,Math.ceil(shown.length/20)-1),currentPage=Math.min(page,lastPage),visible=shown.slice(currentPage*20,currentPage*20+20),nameLength=[...name.trim()].length,descriptionLength=[...description.trim()].length;
 useEffect(()=>{setPage(current=>Math.min(current,lastPage));},[lastPage]);

 return <main className="space-y-6">
  <Link className={textLinkClass} to={localizeHref('/me/library')}>{m.library_title()}</Link>
  <PageTitle description={m.library_private_hint()}>{m.library_edit()}</PageTitle>
  {saved?.moderation?.hidden?<p role="status" className="community-panel break-words text-sm">{m.library_moderated()} {saved.moderation.reason}</p>:null}
  <nav className="community-content-nav" aria-label={m.ui_content_navigation()}><a href="#library-editor-info">{m.ui_library_editor_info()}</a><a href="#library-editor-entries">{m.ui_library_editor_entries()}</a><a href="#library-editor-actions">{m.ui_library_editor_actions()}</a></nav>
  <div className="community-library-editor-grid">
   <div className="community-library-editor-main space-y-6">
    <section aria-labelledby="library-editor-info" className="community-panel space-y-5">
     <div className="space-y-2"><h2 id="library-editor-info" className="text-lg font-semibold">{m.ui_library_editor_info()}</h2><p className="text-sm leading-6 text-muted-foreground">{m.library_private_hint()}</p></div>
     <div className="grid gap-2"><label htmlFor="library-name" className="font-medium">{m.library_name()}</label>
      <Input id="library-name" disabled={busy} value={name} onChange={event=>{setName(event.target.value);setPreview(false);}} maxLength={120} aria-describedby="library-name-count" aria-invalid={nameLength>60}/>
      <p id="library-name-count" className={`text-xs tabular-nums ${nameLength>60?'text-destructive':'text-muted-foreground'}`}>{m.ui_library_character_count({count:String(nameLength),limit:'60'})}</p>
     </div>
     <div className="grid gap-2"><label htmlFor="library-description" className="font-medium">{m.library_description()}</label>
      <Textarea id="library-description" className="min-h-32 leading-7" disabled={busy} value={description} onChange={event=>{setDescription(event.target.value);setPreview(false);}} maxLength={1000} aria-describedby="library-description-count" aria-invalid={descriptionLength>500}/>
      <p id="library-description-count" className={`text-xs tabular-nums ${descriptionLength>500?'text-destructive':'text-muted-foreground'}`}>{m.ui_library_character_count({count:String(descriptionLength),limit:'500'})}</p>
     </div>
    </section>

    <section aria-labelledby="library-editor-entries" className="community-panel space-y-5">
     <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-2"><h2 id="library-editor-entries" className="text-lg font-semibold">{m.ui_library_editor_entries()}</h2><p className="text-sm leading-6 text-muted-foreground">{m.ui_library_editor_entries_hint()}</p></div><p className="community-status tabular-nums">{m.library_count({count:String(entries.length)})} / 200</p></div>
     <form className="space-y-2" onSubmit={event=>{event.preventDefault();if(!busy)addNumber();}}>
      <div className="flex flex-wrap items-end gap-2"><label className="grid min-w-0 flex-1 gap-2 text-sm font-medium">{m.library_add_number()}<Input value={number} onChange={event=>{setNumber(event.target.value);setNumberError(null);}} inputMode="numeric" disabled={busy} aria-invalid={Boolean(numberError)} aria-describedby={numberError?'library-add-hint library-add-error':'library-add-hint'}/></label><Button className="min-h-11" disabled={busy||!number.trim()}>{m.library_add()}</Button></div>
      <p id="library-add-hint" className="text-xs leading-5 text-muted-foreground">{m.ui_library_editor_add_hint()}</p>
      {numberError?<p id="library-add-error" role="alert" className="break-words text-sm text-destructive">{numberError}</p>:null}
     </form>
     <div className="flex flex-wrap items-end justify-between gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm font-medium">{m.library_find()}<Input value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);}}/></label><DownloadAddButton publicIds={entries.filter(entry=>entry.publicId).map(entry=>entry.publicId!)}/></div>
     {filter?<p className="text-sm text-muted-foreground">{m.ui_library_editor_filtered({count:String(shown.length),total:String(entries.length)})}</p>:null}
     {visible.length?<ol className="space-y-3">{visible.map(entry=><li key={entry.ref} draggable={!busy} onDragStart={event=>{if(busy){event.preventDefault();return;}setDrag(entry.index);}} onDragEnd={()=>setDrag(null)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(drag!==null)move(drag,entry.index);setDrag(null);}} className="community-library-entry">
      <p className="min-w-0 break-words text-sm font-medium"><span className="mr-2 tabular-nums text-muted-foreground">{entry.index+1}.</span>{entry.publicId?<Link className={textLinkClass} to={localizeHref(`/charts/${entry.publicId}`)}>{entry.title}</Link>:entry.title}</p>
      <div className="community-library-entry-actions"><Button className="min-h-11" variant="outline" size="sm" disabled={busy||entry.index===0} onClick={()=>move(entry.index,entry.index-1)}>{m.library_up()}</Button><Button className="min-h-11" variant="outline" size="sm" disabled={busy||entry.index===entries.length-1} onClick={()=>move(entry.index,entry.index+1)}>{m.library_down()}</Button><label className="flex min-h-11 items-center gap-2 text-sm">{m.library_position()}<input className="min-h-11 w-20 rounded border bg-background px-2" aria-label={m.library_position_item({id:String(entry.index+1)})} type="number" min={1} max={entries.length} step={1} value={entry.index+1} disabled={busy} onChange={event=>move(entry.index,Number(event.target.value)-1)}/></label><Button className="min-h-11" variant="ghost" size="sm" disabled={busy} onClick={()=>{setEntries(old=>old.filter(item=>item.ref!==entry.ref));setPreview(false);}}>{m.library_remove()}</Button></div>
     </li>)}</ol>:<div className="rounded-xl border border-dashed p-6 text-sm leading-6 text-muted-foreground">{filter?m.ui_library_editor_no_results():m.ui_library_editor_empty()}</div>}
     <nav aria-label={m.ui_library_editor_entries()} className="flex flex-wrap items-center justify-between gap-3"><Button className="min-h-11" variant="outline" disabled={currentPage<=0} onClick={()=>setPage(currentPage-1)}>{m.chart_previous()}</Button><p className="text-xs tabular-nums text-muted-foreground">{m.ui_library_editor_page({page:String(currentPage+1),pages:String(lastPage+1)})}</p><Button className="min-h-11" variant="outline" disabled={currentPage>=lastPage} onClick={()=>setPage(currentPage+1)}>{m.chart_next()}</Button></nav>
    </section>
   </div>

   <aside aria-labelledby="library-editor-actions" className="community-library-editor-sidebar space-y-5">
    <section className="community-panel space-y-4">
     <h2 id="library-editor-actions" className="text-lg font-semibold">{m.ui_library_editor_actions()}</h2>
     <div className="flex flex-wrap items-center gap-2"><span className="community-status">{saved?.publiclyAvailable?m.ui_library_editor_public():m.library_private()}</span>{saved?.publicId?<span className="text-xs tabular-nums text-muted-foreground">#{saved.publicId}</span>:null}</div>
     <p className="text-sm leading-6 text-muted-foreground">{saved?.publiclyAvailable?m.ui_library_editor_public_hint():m.library_private_hint()}</p>
     {dirty?<p role="status" className="text-sm leading-6">{m.library_unsaved()}</p>:saved?<p className="text-sm text-muted-foreground">{m.ui_library_editor_saved()}</p>:null}
     <div className="grid gap-2"><Button className="min-h-11 w-full" disabled={busy||!nameLength||nameLength>60||descriptionLength>500} onClick={()=>void run('save')}>{busy?m.dash_submitting():m.library_save_private()}</Button><Button className="min-h-11 w-full" variant="outline" disabled={busy||dirty||!saved||!entries.length||saved.moderation?.hidden} aria-expanded={preview} aria-controls="library-public-preview" onClick={()=>setPreview(value=>!value)}>{m.library_preview_public()}</Button></div>
     <p className="text-xs leading-5 text-muted-foreground">{m.ui_library_editor_publish_hint()}</p>
     {saved?.publiclyAvailable&&saved.publicId?<Link className={`inline-flex min-h-11 items-center text-sm ${textLinkClass}`} to={localizeHref(`/lists/${saved.publicId}`)}>{m.library_view_public()}</Link>:saved?.publicId?<p className="text-xs text-muted-foreground">{m.library_not_public()}</p>:null}
    </section>
    {saved?<section aria-labelledby="library-editor-manage" className="rounded-xl border border-border/70 p-4 text-sm">
     <h2 id="library-editor-manage" className="font-medium">{m.ui_library_editor_manage()}</h2><p className="mt-2 leading-6 text-muted-foreground">{m.ui_library_editor_manage_hint()}</p>
     <div className="mt-3 flex flex-wrap gap-2">{saved.publication?<Button className="min-h-11" variant="ghost" disabled={busy} onClick={()=>void run('withdraw')}>{m.library_withdraw()}</Button>:null}<Button className="min-h-11" variant="ghost" disabled={busy} aria-expanded={deleting} onClick={()=>setDeleting(value=>!value)}>{m.library_delete()}</Button></div>
     {deleting?<div className="mt-3 space-y-3 rounded-lg border border-destructive/30 p-3"><p className="leading-6">{m.library_delete_hint()}</p><Button className="min-h-11 w-full" variant="destructive" disabled={busy} onClick={()=>void run('delete')}>{m.library_confirm_delete()}</Button></div>:null}
    </section>:null}
   </aside>
  </div>
  {preview&&saved?<section id="library-public-preview" aria-label={m.library_public_preview()} className="community-panel space-y-4">
   <h2 className="text-lg font-semibold">{m.library_public_preview()}</h2><h3 className="break-words text-xl font-semibold">{saved.name}</h3>{saved.description?<p className="whitespace-pre-wrap break-words text-sm leading-7">{saved.description}</p>:null}<ol className="list-inside list-decimal space-y-2">{saved.entries.map(entry=><li key={entry.id} className="break-words text-sm">{entry.chart?.title??m.favorite_unavailable()}</li>)}</ol><p className="text-sm leading-6 text-muted-foreground">{m.library_publish_hint()}</p><Button className="min-h-11" disabled={busy||saved.entries.some(entry=>!entry.chart)} onClick={()=>void run('publish')}>{m.library_confirm_publish()}</Button>
  </section>:null}
  {error?<div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-4"><p className="break-words text-sm">{error}</p>{saved?<Button className="min-h-11" variant="outline" disabled={busy} onClick={()=>void run('reload')}>{m.library_reload()}</Button>:null}</div>:null}
 </main>;
}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DiscussionError error={error}/>;}
