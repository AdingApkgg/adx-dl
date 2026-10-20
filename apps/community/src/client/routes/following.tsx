import { Button } from "@astrodx/ui/components/button";
import { Link, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { Avatar } from "../components/avatar";
import { FollowControls } from "../components/follow-author";
import { DiscussionError, DiscussionPager, PrivateDiscussionGuard } from "../components/discussion-ui";
import { SocialEmpty, SocialNavigation } from "../components/social-ui";
import { PageTitle } from "../components/page-title";
import { loadFollowing } from "../lib/following";
import type { Route } from "./+types/following";
export {headers,shouldRevalidate} from "../lib/following";
export function meta(){return [{title:`${m.following_title()} - ${m.site_name()}`},{name:"robots",content:"noindex, nofollow"}];}
export function loader({context,url}:Route.LoaderArgs){return loadFollowing(context,url,api=>api.list(url.searchParams.get("cursor")??undefined));}
export default function Following({loaderData}:Route.ComponentProps) {
 const {page,userId}=loaderData,revalidator=useRevalidator();
 return <PrivateDiscussionGuard userId={userId}><main className="community-social-page space-y-6">
  <PageTitle description={m.following_hint()}>{m.following_title()}</PageTitle><SocialNavigation view="following" />
  <div className="community-panel flex flex-wrap justify-between gap-3 text-sm"><p>{m.ui_social_page_authors({ count: String(page.items.length) })}</p><p className="text-muted-foreground">{m.ui_social_page_alerts({ count: String(page.items.filter(item => item.notify).length) })}</p></div>
  {page.items.length ? <div className="grid gap-4 xl:grid-cols-2">{page.items.map(item => <article key={`${userId}/${item.id}`} className="community-follow-card community-panel">
    <Link to={localizeHref(`/u/${item.author.publicId}`)} className="flex min-h-11 min-w-0 items-center gap-3"><Avatar id={item.author.id} image={item.author.image} name={item.author.name} size={48} /><div className="min-w-0 space-y-1"><h2 className="break-words font-semibold">{item.author.name}</h2><p className="text-xs text-muted-foreground">{m.user_page_id({ id: item.author.publicId })}</p></div></Link>
    {item.followedAt ? <p className="text-xs text-muted-foreground">{m.ui_social_followed_since({ date: item.followedAt.slice(0, 10) })} UTC</p> : null}
    <FollowControls publicId={item.author.publicId} state={item} onChanged={() => { void revalidator.revalidate(); }} />
  </article>)}</div> : <SocialEmpty title={m.following_empty()}><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/charts")}>{m.public_charts_title()}</Link></Button></SocialEmpty>}
  <DiscussionPager nextCursor={page.nextCursor} />
 </main></PrivateDiscussionGuard>;

}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DiscussionError error={error}/>;}
