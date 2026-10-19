import { data, Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { publicChartFiltersFromParams } from "@/shared/public-chart-search";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { PublicChartBrowser, PublicChartSearchForm } from "../components/public-chart-browser";
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
    const filters = publicChartFiltersFromParams(url.searchParams);
    const page = await publicChartsApi(context.get(apiContext)).list(url.searchParams.get("cursor") ?? undefined, undefined,
      filters);
    return data(page, { headers: publicHeaders });
  } catch (error) {
    throw data(null, { status: error instanceof RangeError ? 400 : error instanceof ApiError && error.status < 500 ? error.status : 503, headers: publicHeaders });
  }
}
export function meta({ loaderData, matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  return [{ title: `${m.public_charts_title()} - ${m.site_name()}` },
    { name: "description", content: m.public_charts_description() },
    ...(!loaderData || location.search ? [{ name: "robots", content: "noindex,follow" }] : []),
    canonicalLink(origin, location.pathname), ...localeAlternates(origin, location.pathname)];
}
export default function PublicCharts({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const filters = publicChartFiltersFromParams(new URLSearchParams(location.search));
  const base = localizeHref("/charts");
  return <main className="space-y-6">
    <PageTitle description={m.public_charts_description()}>{m.public_charts_title()}</PageTitle>
    <Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
    <PublicChartSearchForm filters={filters} base={base} facets={loaderData.facets} />
    <PublicChartBrowser page={loaderData} filters={filters} base={base} />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
