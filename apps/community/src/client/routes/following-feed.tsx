import { Button } from "@astrodx/ui/components/button";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { DiscussionError, DiscussionPager, PrivateDiscussionGuard } from "../components/discussion-ui";
import { PageTitle } from "../components/page-title";
import { PublicChartCard } from "../components/public-chart-card";
import { dashDate } from "../lib/dash";
import { loadFollowing } from "../lib/following";
import type { Route } from "./+types/following-feed";
export {headers,shouldRevalidate} from "../lib/following";
export function meta(){return [{title:`${m.following_feed_title()} - ${m.site_name()}`},{name:"robots",content:"noindex, nofollow"}];}
export function loader({context,url}:Route.LoaderArgs){return loadFollowing(context,url,api=>api.feed(url.searchParams.get("cursor")??undefined));}
export default function FollowingFeed({loaderData}:Route.ComponentProps) {
 const {page,userId}=loaderData;
 return <PrivateDiscussionGuard userId={userId}><main className="space-y-6"><PageTitle description={m.following_feed_hint()}>{m.following_feed_title()}</PageTitle><nav className="flex flex-wrap gap-3" aria-label={m.following_feed_title()}><Button asChild variant="outline"><Link to={localizeHref("/me/following")}>{m.following_manage()}</Link></Button><Button asChild variant="outline"><Link to={localizeHref("/charts")}>{m.public_charts_title()}</Link></Button></nav>
  {page.items.length?<div className="space-y-5">{page.items.map(item=><section key={`${userId}/${item.id}`} className="space-y-2"><time className="text-xs text-muted-foreground" dateTime={item.occurredAt}>{dashDate(item.occurredAt)}</time><PublicChartCard chart={item.chart}/></section>)}</div>:<p className="text-sm text-muted-foreground">{page.nextCursor?m.following_feed_filtered():m.following_feed_empty()}</p>}<DiscussionPager nextCursor={page.nextCursor}/></main></PrivateDiscussionGuard>;
}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DiscussionError error={error}/>;}
