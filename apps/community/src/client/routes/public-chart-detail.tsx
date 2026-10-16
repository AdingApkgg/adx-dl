import { DownloadIcon, PlayCircleIcon } from "lucide-react";
import { ShareChartButton } from "../components/share-chart-button";
import { Button } from "@astrodx/ui/components/button";
import { data, Link, redirect } from "react-router";
import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import type { PublicChartDto } from "@/shared/charts";
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
export async function loader({ context, params, request }: Route.LoaderArgs) {
  let chart: PublicChartDto;
  try { chart = await publicChartsApi(context.get(apiContext)).get(params.id); }
  catch (error) {
    throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503, headers: publicHeaders });
  }
  // Authorize first on every visit. A cached permanent redirect must not outlive withdrawal.
  if (params.id !== chart.publicId) {
    const target = new URL(request.url);
    target.pathname = target.pathname.replace(/\/charts\/[^/]+\/?$/i, `/charts/${chart.publicId}`);
    return redirect(target.pathname + target.search, { status: 302, headers: publicHeaders });
  }
  return data(chart, { headers: publicHeaders });
}
export function meta({ loaderData: chart, matches, location }: Route.MetaArgs) {
  if (!chart) return [{ title: `${m.public_charts_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }];
  const origin = originFrom(matches); const canonical = canonicalLink(origin, location.pathname);
  return [{ title: `${chart.title} - ${m.site_name()}` }, { name: "description", content: chart.artist }, canonical,
    ...localeAlternates(origin, location.pathname),
    ...openGraph({ title: chart.title, description: chart.artist, url: canonical.href, locale: getLocale(), siteName: m.site_name() })];
}
export default function PublicChartDetail({ loaderData: chart }: Route.ComponentProps) {
  const canPreview = chart.summary.difficulties.some(row => row.previewSupported);
  return <main className="space-y-6">
    <Link to={localizeHref("/charts")} className={textLinkClass}>{m.public_charts_title()}</Link>
    <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
      <div className="overflow-hidden rounded-xl border"><PublicCover key={`${chart.id}/${chart.versionId}`} chart={chart} /></div>
      <div className="min-w-0 space-y-3 break-words">
        <PageTitle description={chart.artist}>{chart.title}</PageTitle>
        {chart.author ? <Link to={localizeHref(`/u/${chart.author.id}`)} className="flex items-center gap-2 underline">
          <Avatar image={chart.author.image} id={chart.author.id} name={chart.author.name} size={32} />{m.public_chart_author({ name: chart.author.name })}
        </Link> : <p>{m.public_chart_author({ name: m.public_chart_anonymous() })}</p>}
        <p>{m.chart_version({ number: String(chart.ordinal) })} · {(chart.sourceSize / (1024 * 1024)).toFixed(2)} MiB</p>
        <p className="break-all text-xs text-muted-foreground">{m.chart_publication_version_id({ id: chart.versionId })}</p>
        <time dateTime={chart.updatedAt}>{m.public_chart_updated({ date: chart.updatedAt.slice(0, 10) })}</time>
        <p className="text-sm text-muted-foreground">{m.public_chart_download_hint()}</p>
        <div role="group" aria-label={m.public_chart_actions()} className="flex flex-wrap items-start gap-3">
          {canPreview ? <Button asChild variant="secondary" className="min-h-11"><a href="#chart-preview"><PlayCircleIcon aria-hidden="true" />{m.public_chart_preview_action()}</a></Button> : null}
          <Button asChild className="min-h-11"><a href={publicChartDownloadUrl(chart.publicId)} download><DownloadIcon aria-hidden="true" />{m.public_chart_download()}</a></Button>
          <ShareChartButton key={chart.id} title={chart.title} />
        </div>
        {!canPreview ? <p className="text-sm text-muted-foreground">{m.public_chart_preview_unavailable()}</p> : null}
      </div>
    </div>
    <ChartSummary summary={chart.summary} />
    <PrivateChartPreview sectionId="chart-preview" key={`${chart.id}/${chart.versionId}`} id={chart.publicId} versionId={chart.versionId} summary={chart.summary} assetUrl={publicChartAssetUrl} />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
