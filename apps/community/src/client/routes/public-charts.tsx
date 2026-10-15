import { Button } from "@astrodx/ui/components/button";
import { useState } from "react";
import { data, Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import type { PublicChartDto } from "@/shared/charts";
import { apiContext } from "@/shared/router-context";
import { ErrorCard } from "../components/error-card";
import { PageTitle, textLinkClass } from "../components/page-title";
import { canonicalLink, localeAlternates, originFrom } from "../lib/seo";
import { publicChartAssetUrl, publicChartsApi } from "../queries/public-charts";
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
export function PublicCover({ chart }: { chart: PublicChartDto }) {
  const [failed, setFailed] = useState(false);
  return <div className="relative aspect-square overflow-hidden border-b border-border/60 bg-muted">
    {chart.summary.hasCover && !failed ? <img src={publicChartAssetUrl(chart.id, chart.versionId, "cover")} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} /> :
      <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground">{m.chart_cover()} · {m.chart_missing()}</div>}
  </div>;
}
export function PublicChartCard({ chart }: { chart: PublicChartDto }) {
  return <Link to={localizeHref(`/charts/${chart.id}`)} className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <PublicCover key={`${chart.id}/${chart.versionId}`} chart={chart} />
    <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3 sm:p-4">
      <h2 className="line-clamp-1 font-semibold leading-snug">{chart.title}</h2>
      <p className="line-clamp-1 text-sm text-muted-foreground">{chart.artist || "—"}</p>
      <p className="line-clamp-1 text-xs text-muted-foreground">{m.public_chart_author({ name: chart.author?.name ?? m.public_chart_anonymous() })}</p>
      <ul className="mt-auto flex flex-wrap gap-1.5">{chart.summary.difficulties.map(row => <li key={row.difficulty} className="rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs">
        {m.chart_difficulty({ difficulty: String(row.difficulty) })} · {row.level ?? "—"}{!row.previewSupported ? ` · ${m.chart_unsupported()}` : ""}
      </li>)}</ul>
    </div>
  </Link>;
}
export default function PublicCharts({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const cursors: string[] = Array.isArray(location.state?.cursors) ? location.state.cursors : [];
  const base = localizeHref("/charts");
  return <main className="space-y-6">
    <PageTitle description={m.public_charts_description()}>{m.public_charts_title()}</PageTitle>
    <Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
    {loaderData.items.length ? <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{loaderData.items.map(chart => <li key={chart.id}><PublicChartCard chart={chart} /></li>)}</ul> : <p>{m.public_charts_empty()}</p>}
    <nav aria-label={m.public_charts_title()} className="flex gap-3">
      {location.search ? <Button asChild variant="outline"><Link to={cursors.at(-1) ?? base} state={{ cursors: cursors.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
      {loaderData.nextCursor ? <Button asChild variant="outline"><Link to={`${base}?cursor=${encodeURIComponent(loaderData.nextCursor)}`} state={{ cursors: [...cursors, `${location.pathname}${location.search}`] }}>{m.chart_next()}</Link></Button> : null}
    </nav>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
