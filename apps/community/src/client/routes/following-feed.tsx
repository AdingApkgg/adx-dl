import { Button } from "@astrodx/ui/components/button";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { DiscussionError, DiscussionPager, PrivateDiscussionGuard } from "../components/discussion-ui";
import { PageTitle } from "../components/page-title";
import { PUBLIC_CHART_GRID_CLASS, PublicChartCard } from "../components/public-chart-card";
import { groupSocialDays, SocialEmpty, SocialNavigation } from "../components/social-ui";
import { loadFollowing } from "../lib/following";
import type { Route } from "./+types/following-feed";
export { headers, shouldRevalidate } from "../lib/following";
export function meta() { return [{ title: `${m.following_feed_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export function loader({ context, url }: Route.LoaderArgs) { return loadFollowing(context, url, api => api.feed(url.searchParams.get("cursor") ?? undefined)); }
export default function FollowingFeed({ loaderData }: Route.ComponentProps) {
  const { page, userId } = loaderData;
  return <PrivateDiscussionGuard userId={userId}><main className="community-social-page space-y-6">
    <PageTitle description={m.following_feed_hint()}>{m.following_feed_title()}</PageTitle>
    <SocialNavigation view="feed" />
    <div className="community-section-heading"><p className="text-sm text-muted-foreground">{m.ui_social_page_updates({ count: String(page.items.length) })}</p><Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline" to={localizeHref("/charts")}>{m.public_charts_title()}</Link></div>
    {page.items.length ? groupSocialDays(page.items, item => item.occurredAt).map(([day, items]) => <section key={day} aria-labelledby={`feed-${day}`} className="space-y-4">
      <div className="community-social-day"><h2 id={`feed-${day}`} className="font-semibold"><time dateTime={day}>{day}</time> <span className="text-xs font-normal text-muted-foreground">UTC</span></h2><span className="text-xs tabular-nums text-muted-foreground">{m.ui_social_page_updates({ count: String(items.length) })}</span></div>
      <ul className={PUBLIC_CHART_GRID_CLASS}>{items.map(item => <li key={`${userId}/${item.id}`} className="community-social-feed-card"><PublicChartCard chart={item.chart} headingLevel={3} />{item.chart.author ? <Link className="inline-flex min-h-11 max-w-full items-center break-words text-xs text-muted-foreground hover:text-primary hover:underline" to={localizeHref(`/u/${item.chart.author.publicId}`)}>{m.ui_social_visit_author({ name: item.chart.author.name })}</Link> : null}</li>)}</ul>
    </section>) : <SocialEmpty title={page.nextCursor ? m.following_feed_filtered() : m.following_feed_empty()}><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/charts")}>{m.public_charts_title()}</Link></Button></SocialEmpty>}
    <DiscussionPager nextCursor={page.nextCursor} />
  </main></PrivateDiscussionGuard>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DiscussionError error={error} />; }
