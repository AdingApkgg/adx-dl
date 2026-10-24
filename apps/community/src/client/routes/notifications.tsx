import { MotionSurface } from "../components/motion-ui";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { DiscussionNotification } from "@/shared/discussions";
import { DiscussionError, DiscussionPager, PrivateDiscussionGuard, loadDiscussion, queryParams, safeDiscussionHref, useDiscussionTask } from "../components/discussion-ui";
import { PageTitle } from "../components/page-title";
import { groupSocialDays, notificationFilterHref, SocialEmpty, SocialNavigation } from "../components/social-ui";
import { getBrowserApi } from "../lib/browser";
import { dashDate } from "../lib/dash";
import { discussionApi } from "../queries/discussions";
import type { Route } from "./+types/notifications";
export { headers, shouldRevalidate } from "../components/discussion-ui";
export function loader({ context, url }: Route.LoaderArgs) { return loadDiscussion(context, url, api => api.notifications(queryParams(url, ["unread", "cursor", "kind"])), true); }
export function meta() { return [{ title: `${m.discussion_notifications()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function Notifications({ loaderData }: Route.ComponentProps) {
  return <PrivateDiscussionGuard userId={loaderData.userId}><NotificationCenter key={loaderData.userId} page={loaderData.page} userId={loaderData.userId} /></PrivateDiscussionGuard>;
}
function NotificationCenter({ page, userId }: { page: Route.ComponentProps["loaderData"]["page"]; userId: string | null }) {
  const location = useLocation(), params = new URLSearchParams(location.search), unread = params.get("unread") === "true", updates = params.get("kind") === "author_update";
  const task = useDiscussionTask(), revalidator = useRevalidator(), [completedAt, setCompletedAt] = useState<string | null>(null);
  const refresh = () => { void revalidator.revalidate(); }, unreadIds = page.items.filter(item => !item.read).map(item => item.id);
  async function readPage() {
    setCompletedAt(null);
    if (await task.run(() => discussionApi(getBrowserApi()).read(unreadIds))) { setCompletedAt(location.key); refresh(); }
  }
  return <main className="community-social-page space-y-6">
    <div className="community-page-heading"><PageTitle description={m.discussion_notifications_hint()}>{m.discussion_notifications()}</PageTitle><span className="community-status is-accent">{m.ui_social_notice_unread({ count: String(page.unreadCount) })}</span></div>
    <SocialNavigation view="notifications" />
    <section className="community-filter space-y-4" aria-label={m.ui_social_notice_filters()}>
      <nav className="flex flex-wrap gap-2" aria-label={m.discussion_unread()}>{([false, true] as const).map(value => <Button asChild key={String(value)} variant={unread === value ? "default" : "outline"} className="min-h-11"><Link aria-current={unread === value ? "page" : undefined} to={notificationFilterHref(location.search, { unread: value })}>{value ? m.discussion_unread() : m.discussion_all()}</Link></Button>)}</nav>
      <form key={`${unread}/${updates}`} method="get" action={localizeHref("/me/notifications")} className="flex flex-wrap items-end gap-3">
        {unread ? <input type="hidden" name="unread" value="true" /> : null}
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5 text-sm font-medium">{m.ui_social_notice_kind()}<select name="kind" defaultValue={updates ? "author_update" : ""} className="min-h-11 w-full rounded-lg border bg-background px-3"><option value="">{m.discussion_all()}</option><option value="author_update">{m.following_updates()}</option></select></label>
        <Button type="submit" variant="outline" className="min-h-11">{m.discussion_apply()}</Button>
        {unread || updates ? <Button asChild variant="ghost" className="min-h-11"><Link to={localizeHref("/me/notifications")}>{m.ui_clear_filters()}</Link></Button> : null}
      </form>
    </section>
    <div className="community-section-heading"><p className="text-sm text-muted-foreground">{m.ui_social_notice_page({ count: String(page.items.length), unread: String(unreadIds.length) })}</p><Button variant="outline" className="min-h-11" disabled={task.pending || unreadIds.length === 0} onClick={() => { void readPage(); }}>{m.discussion_read_page()}</Button></div>
    {page.followingUnavailable ? <Alert variant="destructive">{m.following_unavailable()}</Alert> : null}{task.feedback}
    {completedAt === location.key ? <p role="status" className="text-sm text-muted-foreground">{m.ui_social_notice_done()}</p> : null}
    {page.items.length ? groupSocialDays(page.items, item => item.eventAt).map(([day, items]) => <section key={day} aria-labelledby={`notifications-${day}`} className="space-y-3"><div className="community-social-day"><h2 id={`notifications-${day}`} className="font-semibold"><time dateTime={day}>{day}</time> <span className="text-xs font-normal text-muted-foreground">UTC</span></h2></div>{items.map(item => <NotificationRow key={`${userId}/${item.id}/${item.eventAt}`} item={item} refresh={refresh} />)}</section>) : !page.followingUnavailable ? <SocialEmpty title={unread || updates ? m.ui_social_notice_no_match() : m.ui_social_notice_empty()}>{unread || updates ? <Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/me/notifications")}>{m.ui_clear_filters()}</Link></Button> : <><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/me/feed")}>{m.following_feed_title()}</Link></Button><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/forum")}>{m.discussion_forum()}</Link></Button></>}</SocialEmpty> : null}
    <DiscussionPager nextCursor={page.nextCursor} />
  </main>;
}
function NotificationRow({ item, refresh }: { item: DiscussionNotification; refresh: () => void }) {
  const task = useDiscussionTask(), href = item.available ? safeDiscussionHref(item.href) : null;
  const kind = { direct_reply: m.discussion_notice_reply, chart_comment: m.discussion_notice_chart, subscription: m.discussion_notice_subscription, moderation: m.discussion_notice_moderation, report_resolution: m.discussion_notice_resolution, author_update: m.following_updates }[item.kind]();
  return <MotionSurface as="article" className={`community-notification space-y-4 ${item.read ? "" : "is-unread"}`}>
    <div className="community-notification-head"><h3 className="text-sm font-semibold">{kind}</h3><span className={`community-status ${item.read ? "" : "is-accent"}`}>{item.read ? m.ui_social_notice_read() : m.discussion_unread()}</span><time className="text-xs text-muted-foreground" dateTime={item.eventAt}>{dashDate(item.eventAt)}</time></div>
    <div className="community-notification-body space-y-3">{item.available ? <>{item.update?.chart ? <div className="space-y-2"><p className="break-words font-semibold">{item.update.chart.title}</p>{item.update.author ? <Link className="inline-flex min-h-11 items-center text-sm text-primary hover:underline" to={localizeHref(`/u/${item.update.author.publicId}`)}>{item.update.author.name}</Link> : null}{item.update.state === "updated" ? <p className="text-sm text-muted-foreground">{m.following_version_changed()}</p> : null}</div> : null}{item.topic?.state === "visible" ? <p className="break-words font-medium">{item.topic.title}</p> : null}{item.message?.state === "visible" ? <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{item.message.body}</p> : null}{item.publicReason ? <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm leading-7">{item.publicReason}</p> : null}</> : <p className="text-sm text-muted-foreground">{m.discussion_unavailable()}</p>}</div>
    <div className="community-notification-actions">{href ? <Button asChild variant="outline" className="min-h-11"><Link to={href} onClick={() => { if (!item.read) void task.run(() => discussionApi(getBrowserApi()).read([item.id])); }}>{item.update?.state === "updated" ? m.following_open_current() : m.discussion_open()}</Link></Button> : null}{!item.read ? <Button disabled={task.pending} variant="ghost" className="min-h-11" onClick={async () => { if (await task.run(() => discussionApi(getBrowserApi()).read([item.id]))) refresh(); }}>{m.discussion_read()}</Button> : null}</div>{task.feedback}
  </MotionSurface>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DiscussionError error={error} />; }
