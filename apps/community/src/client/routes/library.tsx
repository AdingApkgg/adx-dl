import { EmptyState } from "../components/ui-states";
import { LibraryIcon } from "lucide-react";
import { Button } from "@astrodx/ui/components/button";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { PageTitle, textLinkClass } from "../components/page-title";
import { PrivateDiscussionGuard, DiscussionError } from "../components/discussion-ui";
import { LibraryNavigation, LibraryPager } from "../components/library-ui";
import { reportStatus } from "../lib/community-social";
import { loadLibrary } from "../lib/library";
import type { Route } from "./+types/library";
export { headers, shouldRevalidate } from "../lib/library";

type LibraryData = { kind: "reports"; page: import("@/shared/library").LibraryPage<import("@/shared/library").LibraryReport> } | { kind: "lists"; page: import("@/shared/library").LibraryPage<import("@/shared/library").LibrarySummary> };
export function loader({ context, url }: Route.LoaderArgs) {
  return loadLibrary<LibraryData>(context, url, api => url.searchParams.get("view") === "reports"
    ? api.reports(url.searchParams.get("cursor") ?? undefined).then(page => ({ kind: "reports" as const, page }))
    : api.privateLists(url.searchParams.get("cursor") ?? undefined).then(page => ({ kind: "lists" as const, page })));
}
export const meta = () => [{ title: m.library_title() }, { name: "robots", content: "noindex, nofollow" }];

export default function Library({ loaderData }: Route.ComponentProps) {
  const data = loaderData.page;
  return <PrivateDiscussionGuard userId={loaderData.userId}><main className="space-y-6">
    <header className="community-page-heading">
      <PageTitle description={m.library_private_hint()}>{m.library_title()}</PageTitle>
      <div className="community-toolbar">
        <Button asChild className="min-h-11"><Link to={localizeHref("/me/lists/new")}>{m.library_new()}</Link></Button>
        <Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/lists")}>{m.library_public_title()}</Link></Button>
      </div>
    </header>
    <LibraryNavigation view={data.kind} />
    <section aria-label={data.kind === "lists" ? m.library_my_lists() : m.library_reports()} className="space-y-4">
      <div className="community-section-heading">
        <h2 className="community-section-title">{data.kind === "lists" ? m.library_my_lists() : m.library_reports()}</h2>
        <p className="text-xs text-muted-foreground">{m.ui_library_page_count({ count: String(data.page.items.length) })}</p>
      </div>
      {data.kind === "lists" ? data.page.items.length ? <ul className="community-list-grid">{data.page.items.map(list => <li key={list.id}>
        <article className="community-list-card">
          <div className="community-section-heading"><span className="community-list-icon"><LibraryIcon aria-hidden="true" className="size-5" /></span><span className={`community-status ${list.published ? "is-accent" : ""}`}>{list.published ? m.library_has_publication() : m.library_private()}</span></div>
          <div className="min-w-0 space-y-2"><h3 className="break-words text-lg font-semibold leading-snug"><Link className={`${textLinkClass} block min-h-11 py-1`} to={localizeHref(`/me/lists/${list.id}`)}>{list.name}</Link></h3><p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{list.description || m.ui_library_no_description()}</p></div>
          <div className="mt-auto space-y-3 border-t pt-3"><p className="text-sm font-medium">{m.library_count({ count: String(list.count) })}</p><div className="community-section-heading"><time dateTime={list.updatedAt} className="text-xs text-muted-foreground">{m.ui_library_updated_at({ date: list.updatedAt.slice(0, 10) })}</time><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref(`/me/lists/${list.id}`)}>{m.library_edit()}</Link></Button></div></div>
        </article>
      </li>)}</ul> : <EmptyState title={m.library_empty()} description={m.ui_library_lists_empty_hint()}><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/me/lists/new")}>{m.library_new()}</Link></Button></EmptyState>
        : data.page.items.length ? <ul className="space-y-3">{data.page.items.map(report => <li key={report.id} className="community-panel space-y-3">
          <div className="community-section-heading"><h3 className="font-semibold">#{report.publicId}</h3><span className="community-status">{reportStatus(report.status)}</span></div>
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{report.details}</p>
          {report.resolutionNote ? <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm leading-6">{report.resolutionNote}</p> : null}
          <time dateTime={report.createdAt} className="block text-xs text-muted-foreground">{report.createdAt.slice(0, 10)}</time>
        </li>)}</ul> : <EmptyState title={m.library_empty()} description={m.ui_library_reports_empty_hint()}/>}
    </section>
    <LibraryPager nextCursor={data.page.nextCursor} />
  </main></PrivateDiscussionGuard>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DiscussionError error={error} />; }
