import {Button} from '@astrodx/ui/components/button';
import {Input} from '@astrodx/ui/components/input';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router';
import {m} from '@/paraglide/messages.js';
import {localizeHref} from '@/paraglide/runtime.js';
import type {SearchHit} from '@/shared/discovery-search';
import {discoveryApi} from '../queries/discovery';
import {getRenderApi} from '../lib/browser';
export function DiscoverySearch({initialQuery='',compact=false}:{initialQuery?:string;compact?:boolean}){
 const [query,setQuery]=useState(initialQuery),[focused,setFocused]=useState(false),[composing,setComposing]=useState(false),[open,setOpen]=useState(false),[items,setItems]=useState<SearchHit[]>([]),[active,setActive]=useState(-1),[failed,setFailed]=useState(false);
 const id=useId(),navigate=useNavigate(),location=useLocation(),generation=useRef(0),pending=useRef<AbortController|null>(null);
 const invalidate=useCallback(()=>{++generation.current;pending.current?.abort();pending.current=null;setItems([]);setActive(-1);setOpen(false);setFailed(false);},[]);
 useEffect(()=>{invalidate();setFocused(false);},[location.key,invalidate]);
 useEffect(()=>{const hide=()=>{invalidate();setFocused(false);};window.addEventListener('pagehide',hide);return()=>window.removeEventListener('pagehide',hide);},[invalidate]);
 useEffect(()=>{const epoch=++generation.current;setItems([]);setActive(-1);setFailed(false);if(!focused||composing||!query.trim())return;
 const controller=new AbortController();pending.current=controller;const timer=setTimeout(()=>{void discoveryApi(getRenderApi()).suggestions(query,controller.signal).then(r=>{if(generation.current===epoch&&!controller.signal.aborted){setItems(r);setOpen(true);}},()=>{if(generation.current===epoch&&!controller.signal.aborted){setFailed(true);setOpen(false);}});},150);
 return()=>{clearTimeout(timer);controller.abort();};},[query,focused,composing]);
 useEffect(()=>{setQuery(initialQuery);},[initialQuery]);
 return <form method="get" action={localizeHref('/search')} role="search" aria-label={m.discovery_search_label()} className={`relative ${compact?'w-full':'rounded-2xl border bg-card p-4 sm:p-6'}`} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){setFocused(false);invalidate();}}} onSubmit={e=>{e.preventDefault();if(composing)return;const target=open&&active>=0&&items[active]?localizeHref(items[active].url):localizeHref(`/search?${new URLSearchParams({q:query})}`);invalidate();setFocused(false);void navigate(target);}}>
 <div className="flex gap-2"><Input role="combobox" aria-label={m.discovery_search_label()} aria-autocomplete="list" aria-expanded={open&&items.length>0} aria-controls={id} aria-activedescendant={active>=0?`${id}-${active}`:undefined} autoComplete="off" name="q" type="search" value={query} maxLength={240} placeholder={m.discovery_search_hint()} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onFocus={()=>setFocused(true)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={e=>{setComposing(false);setQuery(e.currentTarget.value);}} onKeyDown={e=>{if(e.nativeEvent.isComposing||composing)return;if(e.key==='Escape'){e.preventDefault();invalidate();}if((e.key==='ArrowDown'||e.key==='ArrowUp')&&items.length){e.preventDefault();setOpen(true);setActive(n=>(n+(e.key==='ArrowDown'?1:-1)+items.length)%items.length);}}} className="min-h-11 min-w-0 flex-1"/><Button type="submit" className="min-h-11">{m.public_charts_search()}</Button></div>
 {open&&items.length?<div id={id} role="listbox" tabIndex={-1} aria-label={m.discovery_suggestions()} className="absolute inset-x-0 top-full z-30 space-y-1 rounded-xl border bg-background p-2 shadow-lg">{items.map((hit,i)=><div key={hit.publicId} role="option" tabIndex={-1} id={`${id}-${i}`} aria-selected={i===active}><Link to={localizeHref(hit.url)} className={`block min-h-11 rounded-lg p-3 ${i===active?'bg-muted':''}`} onPointerDown={()=>setActive(i)} onClick={()=>{invalidate();setFocused(false);}}><span className="font-medium">{hit.title}</span>{hit.reason?<span className="ml-2 break-words text-xs text-muted-foreground">{reasonLabel(hit.reason.kind)}: {hit.reason.label}</span>:null}</Link></div>)}</div>:null}
 {failed?<p role="status" className="text-sm text-muted-foreground">{m.discovery_suggestion_failed()}</p>:null}
 </form>;
}
export function reasonLabel(kind:NonNullable<SearchHit['reason']>['kind']){return ({id:m.discovery_reason_id,title:m.discovery_reason_title,alias:m.discovery_reason_alias,author:m.discovery_reason_author,artist:m.discovery_reason_artist,designer:m.discovery_reason_designer,tag:m.discovery_reason_tag,body:m.discovery_reason_body})[kind]();}
