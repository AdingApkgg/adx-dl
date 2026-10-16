import { Button } from "@astrodx/ui/components/button";
import { data, Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { PUBLIC_CHART_GRID_CLASS, PublicChartCard } from "../components/public-chart-card";
export { PublicChartCard, PublicCover } from "../components/public-chart-card";
import { ErrorCard } from "../components/error-card";
import { PageTitle, textLinkClass } from "../components/page-title";
import { canonicalLink, localeAlternates, originFrom } from "../lib/seo";
import { publicChartsApi } from "../queries/public-charts";
import type { Route } from "./+types/public-charts";

export const publicHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function headers() { return publicHeaders; }
export function shouldRevalidate() { return true; }
export async function loader({ context, url }: Route.LoaderArgs) {
  try {
    const page = await publicChartsApi(context.get(apiContext)).list(url.searchParams.get("cursor") || undefined);
    return data(page, { headers: publicHeaders });
  } catch (error) {
    throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503, headers: publicHeaders });
  }
}
export function meta({ loaderData, matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  return [{ title: `${m.public_charts_title()} - ${m.site_name()}` },
    { name: "description", content: m.public_charts_description() },
    ...(!loaderData || location.search ? [{ name: "robots", content: "noindex" }] : []),
    canonicalLink(origin, location.pathname), ...localeAlternates(origin, location.pathname)];
}
export default function PublicCharts({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const cursors: string[] = Array.isArray(location.state?.cursors) ? location.state.cursors : [];
  const base = localizeHref("/charts");
  return <main className="space-y-6">
    <PageTitle description={m.public_charts_description()}>{m.public_charts_title()}</PageTitle>
    <Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
    {loaderData.items.length ? <ul className={PUBLIC_CHART_GRID_CLASS}>{loaderData.items.map(chart => <li key={chart.id}><PublicChartCard chart={chart} /></li>)}</ul> : <p>{m.public_charts_empty()}</p>}
    <nav aria-label={m.public_charts_title()} className="flex gap-3">
      {location.search ? <Button asChild variant="outline"><Link to={cursors.at(-1) ?? base} state={{ cursors: cursors.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
      {loaderData.nextCursor ? <Button asChild variant="outline"><Link to={`${base}?cursor=${encodeURIComponent(loaderData.nextCursor)}`} state={{ cursors: [...cursors, `${location.pathname}${location.search}`] }}>{m.chart_next()}</Link></Button> : null}
    </nav>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
