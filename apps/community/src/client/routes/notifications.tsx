import { Button } from "@astrodx/ui/components/button";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { DiscussionNotification } from "@/shared/discussions";
import { DiscussionPager, PrivateDiscussionGuard, loadDiscussion, queryParams, safeDiscussionHref, useDiscussionTask } from "../components/discussion-ui";
import { DiscussionError } from "../components/discussion-ui";
import { PageTitle } from "../components/page-title";
import { getBrowserApi } from "../lib/browser";
import { dashDate } from "../lib/dash";
import { discussionApi } from "../queries/discussions";
import type { Route } from "./+types/notifications";
export { headers, shouldRevalidate } from "../components/discussion-ui";
export function loader({ context, url }: Route.LoaderArgs) { return loadDiscussion(context, url, api => api.notifications(queryParams(url, ["unread", "cursor"])), true); }
export function meta() { return [{ title: `${m.discussion_notifications()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function Notifications({ loaderData }: Route.ComponentProps) {
  const page = loaderData.page, location = useLocation(), unread = new URLSearchParams(location.search).get("unread") === "true", task = useDiscussionTask(), revalidator = useRevalidator(), groups = new Map<string, DiscussionNotification[]>();
  for (const notification of page.items) { const day = notification.eventAt.slice(0, 10); groups.set(day, [...(groups.get(day) ?? []), notification]); }
  const refresh = () => { void revalidator.revalidate(); }, unreadIds = page.items.filter(item => !item.read).map(item => item.id);
  return <PrivateDiscussionGuard userId={loaderData.userId}><main className="space-y-6"><PageTitle description={m.discussion_notifications_hint()}>{m.discussion_notifications()} · {page.unreadCount}</PageTitle><nav className="flex flex-wrap gap-3" aria-label={m.discussion_notifications()}><Button asChild variant={!unread ? "default" : "outline"}><Link to={localizeHref("/me/notifications")}>{m.discussion_all()}</Link></Button><Button asChild variant={unread ? "default" : "outline"}><Link to={`${localizeHref("/me/notifications")}?unread=true`}>{m.discussion_unread()}</Link></Button><Button variant="outline" disabled={task.pending || unreadIds.length === 0} onClick={async () => { if (await task.run(() => discussionApi(getBrowserApi()).read(unreadIds))) refresh(); }}>{m.discussion_read_page()}</Button></nav>{task.feedback}
    {page.items.length ? [...groups.entries()].map(([day, items]) => <section key={day} className="space-y-3"><h2 className="text-sm font-semibold">{day} UTC</h2>{items.map(item => <NotificationRow key={`${loaderData.userId}/${item.id}/${item.eventAt}`} item={item} refresh={refresh} />)}</section>) : <p>{m.discussion_empty()}</p>}<DiscussionPager nextCursor={page.nextCursor} /></main></PrivateDiscussionGuard>;
}
function NotificationRow({ item, refresh }: { item: DiscussionNotification; refresh: () => void }) {
  const task = useDiscussionTask(), href = item.available ? safeDiscussionHref(item.href) : null;
  const kind = { direct_reply: m.discussion_notice_reply, chart_comment: m.discussion_notice_chart, subscription: m.discussion_notice_subscription, moderation: m.discussion_notice_moderation, report_resolution: m.discussion_notice_resolution }[item.kind]();
  return <article className={`space-y-2 rounded-xl border p-4 ${item.read ? "" : "border-primary"}`}><h3 className="font-semibold">{kind}{!item.read ? ` · ${m.discussion_unread()}` : ""}</h3>{item.available ? <>{item.topic?.state === "visible" ? <p className="break-words">{item.topic.title}</p> : null}{item.message?.state === "visible" ? <p className="whitespace-pre-wrap break-words text-sm">{item.message.body}</p> : null}{item.publicReason ? <p className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm">{item.publicReason}</p> : null}</> : <p className="text-sm text-muted-foreground">{m.discussion_unavailable()}</p>}<time className="block text-xs text-muted-foreground" dateTime={item.eventAt}>{dashDate(item.eventAt)}</time><div className="flex flex-wrap gap-3">{href ? <Link className="inline-flex min-h-11 items-center underline" to={href} onClick={() => { if (!item.read) void task.run(() => discussionApi(getBrowserApi()).read([item.id])); }}>{m.discussion_open()}</Link> : null}{!item.read ? <Button disabled={task.pending} variant="outline" onClick={async () => { if (await task.run(() => discussionApi(getBrowserApi()).read([item.id]))) refresh(); }}>{m.discussion_read()}</Button> : null}</div>{task.feedback}</article>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DiscussionError error={error} />; }
