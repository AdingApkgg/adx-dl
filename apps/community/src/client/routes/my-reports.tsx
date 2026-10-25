import { EmptyState } from "../components/ui-states";
import { GovernanceNavigation } from "../components/governance-ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { PageTitle, textLinkClass } from "../components/page-title";
import { ErrorCard } from "../components/error-card";
import { SocialPager } from "../components/social-pager";
import { getRenderApi } from "../lib/browser";
import { loadSocial, reportCategory, reportStatus } from "../lib/community-social";
import { dashDate } from "../lib/dash";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/my-reports";
export { headers, shouldRevalidate } from "../lib/community-social";
export async function loader({ context, url }: Route.LoaderArgs) { return loadSocial(context, url, api => api.reports(url.searchParams.get("cursor") ?? undefined)); }
export function meta() { return [{ title: `${m.my_reports()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function MyReports({ loaderData }: Route.ComponentProps) {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  if (me === null || me && (me.id !== loaderData.userId || me.status !== "active")) return null;
  return <main className="community-record-page space-y-6"><PageTitle description={m.ui_chart_reports_hint()}>{m.my_reports()}</PageTitle><GovernanceNavigation view="reports"/><p className="community-context-note">{m.reports_private()} <Link className={textLinkClass} to={localizeHref("/me/discussions?kind=reports")}>{m.ui_discussion_reports()}</Link></p>
    {loaderData.page.items.length ? <ul className="community-record-list">{loaderData.page.items.map(report => <li key={report.id} className="community-panel space-y-3">
      <h2 className="break-words font-semibold">{report.chart ? <Link to={localizeHref(`/charts/${report.publicId}`)} className={textLinkClass}>{report.chart.title}</Link> : m.social_chart_number({ id: report.publicId })}</h2>
      {!report.chart ? <p className="text-sm text-muted-foreground">{m.social_chart_unavailable()}</p> : null}
      <p className="text-sm">{reportCategory(report.category)} · {reportStatus(report.status)}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{report.details}</p><time className="text-xs text-muted-foreground" dateTime={report.createdAt}>{dashDate(report.createdAt)}</time>
      {report.resolutionNote ? <div className="space-y-1 rounded-lg bg-muted p-3 text-sm"><p>{m.report_resolution_note()}</p><p className="whitespace-pre-wrap break-words">{report.resolutionNote}</p><p className="text-xs">{dashDate(report.resolvedAt)}</p></div> : null}
    </li>)}</ul> : <EmptyState title={m.reports_empty()} description={m.ui_reports_empty_hint()}><Link className="community-inline-action" to={localizeHref("/charts")}>{m.public_charts_title()}</Link></EmptyState>}
    <SocialPager base="/me/reports" nextCursor={loaderData.page.nextCursor} />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
