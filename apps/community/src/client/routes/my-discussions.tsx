import { EmptyState } from "../components/ui-states";
import { Button } from "@astrodx/ui/components/button";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { DiscussionPage, DiscussionReport, MyDiscussion } from "@/shared/discussions";
import { DiscussionDraftBoundary, DiscussionMessageCard, DiscussionPager, DiscussionTopicRow, PrivateDiscussionGuard, loadDiscussion, safeDiscussionHref, useDiscussionTask } from "../components/discussion-ui";
import { DiscussionError } from "../components/discussion-ui";
import { PageTitle } from "../components/page-title";
import { getBrowserApi } from "../lib/browser";
import { reportCategory, reportStatus } from "../lib/community-social";
import { dashDate } from "../lib/dash";
import { discussionApi } from "../queries/discussions";
import type { Route } from "./+types/my-discussions";
export { headers, shouldRevalidate } from "../components/discussion-ui";
export function loader({ context, url }: Route.LoaderArgs) { const kind = url.searchParams.get("kind") ?? "topics", cursor = url.searchParams.get("cursor") ?? undefined; return loadDiscussion(context, url, async api => ({ kind, discussions: kind === "reports" ? { items: [], nextCursor: null } as DiscussionPage<MyDiscussion> : await api.mine(kind, cursor), reports: kind === "reports" ? await api.myReports(cursor) : { items: [], nextCursor: null } as DiscussionPage<DiscussionReport> }), true); }
export function meta() { return [{ title: `${m.discussion_mine()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function MyDiscussions({ loaderData }: Route.ComponentProps) {
  const { kind, discussions, reports } = loaderData.page, revalidator = useRevalidator();
  return <PrivateDiscussionGuard userId={loaderData.userId}><DiscussionDraftBoundary><main className="community-record-page space-y-6"><PageTitle description={m.discussion_private_hint()}>{m.discussion_mine()}</PageTitle><nav className="community-content-nav" aria-label={m.discussion_mine()}>{[["topics", m.discussion_my_topics()], ["replies", m.discussion_my_replies()], ["subscriptions", m.discussion_subscriptions()], ["reports", m.ui_discussion_reports()]].map(([value, label]) => <Link key={value} aria-current={kind===value?"page":undefined} to={`${localizeHref("/me/discussions")}?kind=${value}`}>{label}</Link>)}</nav>
    {kind === "reports" ? <section className="space-y-4">{reports.items.length ? reports.items.map(report => <article key={report.id} className="community-panel space-y-3"><p className="text-sm">{reportCategory(report.category)} · {reportStatus(report.status)}</p><p className="whitespace-pre-wrap break-words">{report.details}</p><time className="text-xs" dateTime={report.createdAt}>{dashDate(report.createdAt)}</time>{report.resolutionNote ? <p className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm">{report.resolutionNote}</p> : null}</article>) : <EmptyState title={m.reports_empty()} description={m.ui_reports_empty_hint()}><Link className="community-inline-action" to={localizeHref("/me/reports")}>{m.ui_chart_reports()}</Link></EmptyState>}</section> : <section className="space-y-4">{discussions.items.length ? discussions.items.map(item => <PersonalDiscussion key={`${loaderData.userId}/${item.id}`} item={item} subscriptions={kind === "subscriptions"} refresh={() => { void revalidator.revalidate(); }} />) : <EmptyState title={m.discussion_empty()} description={m.ui_discussions_empty_hint()}><Link className="community-inline-action" to={localizeHref("/forum")}>{m.site_forum()}</Link></EmptyState>}</section>}
    <DiscussionPager nextCursor={kind === "reports" ? reports.nextCursor : discussions.nextCursor} /></main></DiscussionDraftBoundary></PrivateDiscussionGuard>;
}
function PersonalDiscussion({ item, subscriptions, refresh }: { item: MyDiscussion; subscriptions: boolean; refresh: () => void }) {
  const task = useDiscussionTask(), href = safeDiscussionHref(item.href), location = useLocation();
  return <article className="community-panel space-y-4"><p className="text-xs text-muted-foreground">{item.kind === "forum_topic" ? m.discussion_my_topics() : item.kind === "forum_reply" ? m.discussion_replies() : m.discussion_comments()} · <time dateTime={item.createdAt}>{dashDate(item.createdAt)}</time></p>
    {item.topic ? <DiscussionTopicRow topic={item.topic} /> : item.message ? <DiscussionMessageCard message={item.message} targetType={item.kind === "chart_comment" ? "chart_comment" : "forum_reply"} onChanged={refresh} /> : <p>{m.discussion_unavailable()}</p>}
    <div className="flex flex-wrap gap-3">{href ? <Link to={href} className="inline-flex min-h-11 items-center underline">{m.discussion_open()}</Link> : null}{item.topic?.state === "visible" && !subscriptions ? <Link className="inline-flex min-h-11 items-center underline" to={`${localizeHref(`/forum/${item.topic.publicId}`)}?edit=1`} state={{ returnTo: location.pathname + location.search }}>{m.discussion_edit()}</Link> : null}{subscriptions && item.topic ? <Button variant="outline" disabled={task.pending} onClick={async () => { if (await task.run(() => discussionApi(getBrowserApi()).subscribe(item.topic!.publicId, false))) refresh(); }}>{m.discussion_unsubscribe()}</Button> : null}</div>{task.feedback}
  </article>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DiscussionError error={error} />; }
