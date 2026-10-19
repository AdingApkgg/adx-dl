import {Link,useLocation} from "react-router";
import {Button} from "@astrodx/ui/components/button";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import type {PublicListSummary} from "@/shared/library";
export function PublicListCard({list}:{list:PublicListSummary}){return <article className="space-y-2 break-words rounded-xl border bg-card p-4"><h2 className="text-lg font-semibold"><Link to={localizeHref(`/lists/${list.publicId}`)} className="underline-offset-4 hover:underline">{list.name}</Link></h2><p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{list.description}</p><p className="text-sm">{m.library_count({count:String(list.total)})} · <Link className="underline" to={localizeHref(`/u/${list.author.publicId}`)}>{list.author.name}</Link></p><time dateTime={list.publishedAt} className="text-xs text-muted-foreground">{list.publishedAt.slice(0,10)}</time></article>;}
export function LibraryPager({nextCursor}:{nextCursor:string|null}){const location=useLocation();if(!nextCursor)return null;const params=new URLSearchParams(location.search);params.set('cursor',nextCursor);return <Button asChild variant="outline"><Link to={`${location.pathname}?${params}`}>{m.library_more()}</Link></Button>;}
