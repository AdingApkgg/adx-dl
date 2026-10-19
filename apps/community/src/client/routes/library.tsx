import {reportStatus} from "../lib/community-social";
import {Button} from "@astrodx/ui/components/button";
import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {PageTitle} from "../components/page-title";
import {PrivateDiscussionGuard,DiscussionError} from "../components/discussion-ui";
import {LibraryPager} from "../components/library-ui";
import {loadLibrary} from "../lib/library";
import type {Route} from "./+types/library";
export {headers,shouldRevalidate} from "../lib/library";
export function loader({context,url}:Route.LoaderArgs){return loadLibrary(context,url,api=>url.searchParams.get('view')==='reports'?api.reports(url.searchParams.get('cursor')??undefined).then(page=>({kind:'reports' as const,page})):api.privateLists(url.searchParams.get('cursor')??undefined).then(page=>({kind:'lists' as const,page})));}
export const meta=()=>[{title:m.library_title()},{name:'robots',content:'noindex, nofollow'}];
export default function Library({loaderData}:Route.ComponentProps){const data=loaderData.page;return <PrivateDiscussionGuard userId={loaderData.userId}><main className="space-y-6"><PageTitle description={m.library_private_hint()}>{m.library_title()}</PageTitle><nav className="flex flex-wrap gap-3"><Button asChild><Link to={localizeHref('/me/lists/new')}>{m.library_new()}</Link></Button><Button asChild variant="outline"><Link to={localizeHref('/me/favorites')}>{m.my_favorites()}</Link></Button><Button asChild variant="outline"><Link to={localizeHref('/me/library')}>{m.library_my_lists()}</Link></Button><Button asChild variant="outline"><Link to={localizeHref('/me/library?view=reports')}>{m.library_reports()}</Link></Button></nav>{data.kind==='lists'?data.page.items.length?<ul className="grid gap-4 sm:grid-cols-2">{data.page.items.map(l=><li key={l.id} className="space-y-2 rounded-xl border p-4"><h2 className="break-words font-semibold"><Link className="underline" to={localizeHref(`/me/lists/${l.id}`)}>{l.name}</Link></h2><p className="line-clamp-3 break-words text-sm text-muted-foreground">{l.description}</p><p>{m.library_count({count:String(l.count)})}</p><p className="text-sm">{l.published?m.library_has_publication():m.library_private()}</p></li>)}</ul>:<p>{m.library_empty()}</p>:data.page.items.length?<ul className="space-y-3">{data.page.items.map(r=><li key={r.id} className="space-y-2 rounded-xl border p-4"><p>#{r.publicId} · {reportStatus(r.status)}</p><p className="whitespace-pre-wrap break-words">{r.details}</p>{r.resolutionNote?<p className="break-words">{r.resolutionNote}</p>:null}</li>)}</ul>:<p>{m.library_empty()}</p>}<LibraryPager nextCursor={data.page.nextCursor}/></main></PrivateDiscussionGuard>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DiscussionError error={error}/>;}
