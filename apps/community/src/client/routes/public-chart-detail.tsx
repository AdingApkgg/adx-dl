import { Button } from "@astrodx/ui/components/button";
import { data, Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { Avatar } from "../components/avatar";
import { ChartSummary } from "../components/chart-summary";
import { ErrorCard } from "../components/error-card";
import { PageTitle, textLinkClass } from "../components/page-title";
import { PrivateChartPreview } from "../components/private-chart-preview";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { publicChartAssetUrl, publicChartDownloadUrl, publicChartsApi } from "../queries/public-charts";
import { PublicCover } from "../components/public-chart-card";
import { publicHeaders } from "./public-charts";
import type { Route } from "./+types/public-chart-detail";
export function headers() { return publicHeaders; }
export function shouldRevalidate() { return true; }
export async function loader({ context, params }: Route.LoaderArgs) {
  try { return data(await publicChartsApi(context.get(apiContext)).get(params.id), { headers: publicHeaders }); }
  catch (error) {
    throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503, headers: publicHeaders });
  }
}
export function meta({ loaderData: chart, matches, location }: Route.MetaArgs) {
  if (!chart) return [{ title: `${m.public_charts_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }];
  const origin = originFrom(matches); const canonical = canonicalLink(origin, location.pathname);
  return [{ title: `${chart.title} - ${m.site_name()}` }, { name: "description", content: chart.artist }, canonical,
    ...localeAlternates(origin, location.pathname),
    ...openGraph({ title: chart.title, description: chart.artist, url: canonical.href, locale: getLocale(), siteName: m.site_name() })];
}
export default function PublicChartDetail({ loaderData: chart }: Route.ComponentProps) {
  return <main className="space-y-6">
    <Link to={localizeHref("/charts")} className={textLinkClass}>{m.public_charts_title()}</Link>
    <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
      <div className="overflow-hidden rounded-xl border"><PublicCover key={`${chart.id}/${chart.versionId}`} chart={chart} /></div>
      <div className="space-y-3">
        <PageTitle description={chart.artist}>{chart.title}</PageTitle>
        {chart.author ? <Link to={localizeHref(`/u/${chart.author.id}`)} className="flex items-center gap-2 underline">
          <Avatar image={chart.author.image} id={chart.author.id} name={chart.author.name} size={32} />{m.public_chart_author({ name: chart.author.name })}
        </Link> : <p>{m.public_chart_author({ name: m.public_chart_anonymous() })}</p>}
        <p>{m.chart_version({ number: String(chart.ordinal) })} · {(chart.sourceSize / (1024 * 1024)).toFixed(2)} MiB</p>
        <p>{m.chart_publication_version_id({ id: chart.versionId })}</p>
        <time dateTime={chart.updatedAt}>{m.public_chart_updated({ date: chart.updatedAt.slice(0, 10) })}</time>
        <p className="text-sm text-muted-foreground">{m.public_chart_download_hint()}</p>
        <Button asChild><a href={publicChartDownloadUrl(chart.id)} download>{m.public_chart_download()}</a></Button>
      </div>
    </div>
    <ChartSummary summary={chart.summary} />
    <PrivateChartPreview key={`${chart.id}/${chart.versionId}`} id={chart.id} versionId={chart.versionId} summary={chart.summary} assetUrl={publicChartAssetUrl} />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
