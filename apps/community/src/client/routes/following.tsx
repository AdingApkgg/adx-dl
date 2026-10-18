import { Button } from "@astrodx/ui/components/button";
import { Link, useNavigate } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { Avatar } from "../components/avatar";
import { FollowControls } from "../components/follow-author";
import { DiscussionError, DiscussionPager, PrivateDiscussionGuard } from "../components/discussion-ui";
import { PageTitle } from "../components/page-title";
import { loadFollowing } from "../lib/following";
import type { Route } from "./+types/following";
export {headers,shouldRevalidate} from "../lib/following";
export function meta(){return [{title:`${m.following_title()} - ${m.site_name()}`},{name:"robots",content:"noindex, nofollow"}];}
export function loader({context,url}:Route.LoaderArgs){return loadFollowing(context,url,api=>api.list(url.searchParams.get("cursor")??undefined));}
export default function Following({loaderData}:Route.ComponentProps) {
 const {page,userId}=loaderData,navigate=useNavigate();
 return <PrivateDiscussionGuard userId={userId}><main className="space-y-6"><PageTitle description={m.following_hint()}>{m.following_title()}</PageTitle><nav className="flex flex-wrap gap-3" aria-label={m.following_title()}><Button asChild><Link to={localizeHref("/me/feed")}>{m.following_feed_title()}</Link></Button><Button asChild variant="outline"><Link to={localizeHref("/me/notifications")}>{m.site_notifications()}</Link></Button></nav>
  {page.items.length?<div className="space-y-4">{page.items.map(item=><article key={`${userId}/${item.id}`} className="space-y-3 rounded-xl border bg-card p-4"><Link to={localizeHref(`/u/${item.author.publicId}`)} className="flex min-h-11 items-center gap-3"><Avatar id={item.author.id} image={item.author.image} name={item.author.name} size={36}/><span className="break-words font-medium">{item.author.name}</span></Link><FollowControls publicId={item.author.publicId} state={item} onChanged={()=>{void navigate(localizeHref("/me/following"),{replace:true});}}/></article>)}</div>:<p className="text-sm text-muted-foreground">{m.following_empty()}</p>}<DiscussionPager nextCursor={page.nextCursor}/></main></PrivateDiscussionGuard>;
}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DiscussionError error={error}/>;}
