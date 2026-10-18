import {Link} from "react-router";
import {getLocale,localizeHref} from "@/paraglide/runtime.js";
import {m} from "@/paraglide/messages.js";
import {noticeText,type PublicNotice} from "@/shared/community-site";
export function SiteNoticeList({items}:{items:PublicNotice[]}){
 return <ul className="space-y-3">{items.map(({id,publication:p})=>{
  const title=noticeText(p.title,getLocale()),body=noticeText(p.body,getLocale());
  return <li key={id} className="space-y-2 rounded-xl border bg-card p-4">
   <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold break-words">{title.text}</h3>{p.level==="important"?<span className="rounded bg-destructive px-2 py-1 text-xs text-white">{m.site_important()}</span>:null}</div>
   <p className="whitespace-pre-wrap break-words text-sm">{body.text}</p>
   {p.href&&p.linkLabel?<Link to={localizeHref(p.href)} className="inline-flex min-h-11 items-center underline">{noticeText(p.linkLabel,getLocale()).text}</Link>:null}
   {title.fallback||body.fallback?<p className="text-xs text-muted-foreground">{m.site_translation_fallback()}</p>:null}
   <time className="block text-xs text-muted-foreground" dateTime={p.publishedAt}>{p.publishedAt.slice(0,10)}</time>
  </li>;
 })}</ul>;
}
