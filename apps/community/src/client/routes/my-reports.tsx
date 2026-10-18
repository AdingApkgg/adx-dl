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
  return <main className="space-y-6"><PageTitle description={m.reports_private()}>{m.my_reports()}</PageTitle>
    {loaderData.page.items.length ? <ul className="list-none space-y-4 p-0">{loaderData.page.items.map(report => <li key={report.id} className="space-y-2 rounded-xl border p-4">
      <h2 className="break-words font-semibold">{report.chart ? <Link to={localizeHref(`/charts/${report.publicId}`)} className={textLinkClass}>{report.chart.title}</Link> : m.social_chart_number({ id: report.publicId })}</h2>
      {!report.chart ? <p className="text-sm text-muted-foreground">{m.social_chart_unavailable()}</p> : null}
      <p className="text-sm">{reportCategory(report.category)} · {reportStatus(report.status)}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{report.details}</p><time className="text-xs text-muted-foreground" dateTime={report.createdAt}>{dashDate(report.createdAt)}</time>
      {report.resolutionNote ? <div className="space-y-1 rounded-lg bg-muted p-3 text-sm"><p>{m.report_resolution_note()}</p><p className="whitespace-pre-wrap break-words">{report.resolutionNote}</p><p className="text-xs">{dashDate(report.resolvedAt)}</p></div> : null}
    </li>)}</ul> : <p>{m.reports_empty()}</p>}
    <SocialPager base="/me/reports" nextCursor={loaderData.page.nextCursor} />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
