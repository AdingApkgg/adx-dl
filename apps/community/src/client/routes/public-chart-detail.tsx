import {discoveryApi} from "../queries/discovery";
import {parsePreviewShare,type PreviewShare} from "@/shared/discovery-search";
import {PublicListCard} from "../components/library-ui";
import {DownloadAddButton} from "../components/download-actions";
import { FollowAuthor } from "../components/follow-author";
import {ChartDiscussion} from "../components/chart-discussion";
import { DownloadIcon, PlayCircleIcon } from "lucide-react";
import { ChartCommunityActions } from "../components/chart-community-actions";
import { ShareChartButton } from "../components/share-chart-button";
import { Button } from "@astrodx/ui/components/button";
import { data, Link, redirect, useLocation } from "react-router";
import { publicListBackState, publicListReturnState } from "../lib/public-chart-navigation";
import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import type { PublicChartDto } from "@/shared/charts";
import type { ChartDifficulty } from "@/shared/charts";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import { Avatar } from "../components/avatar";
import { ChartSummary } from "../components/chart-summary";
import { ErrorCard } from "../components/error-card";
import { PageTitle, textLinkClass } from "../components/page-title";
import { PrivateChartPreview } from "../components/private-chart-preview";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { publicChartAssetUrl, publicChartDownloadUrl, publicChartsApi } from "../queries/public-charts";
import { PUBLIC_CHART_GRID_CLASS, PublicChartCard, PublicChartTags, PublicCover } from "../components/public-chart-card";
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
  let related: PublicChartDto[] | null = null;
  try { related = await publicChartsApi(context.get(apiContext)).related(chart.publicId); } catch {}
  let share:PreviewShare|null=null,shareInvalid=false;
  try{share=parsePreviewShare(new URL(request.url).searchParams);if(share&&!chart.summary.difficulties.some(d=>d.difficulty===share!.difficulty&&d.previewSupported)){share=null;shareInvalid=true;}}catch{shareInvalid=true;}
  const [other,lists]=await Promise.all([chart.author?.publicId?publicChartsApi(context.get(apiContext)).list(undefined,7,{author:chart.author.publicId}).then(p=>p.items.filter(c=>c.publicId!==chart.publicId).slice(0,6)).catch(()=>null):Promise.resolve([]),discoveryApi(context.get(apiContext)).lists(chart.publicId).catch(()=>null)]);
  return data({ ...chart, related,other,lists,share,shareInvalid }, { headers: publicHeaders });
}
export function meta({ loaderData: chart, matches, location }: Route.MetaArgs) {
  if (!chart) return [{ title: `${m.public_charts_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }];
  const origin = originFrom(matches); const canonical = canonicalLink(origin, location.pathname);
  const description = Array.from((chart.description || chart.artist).replace(/\s+/g, " ").trim()).slice(0,160).join("");
  return [{ title: `${chart.title} - ${m.site_name()}` }, { name: "description", content: description }, canonical,
    ...localeAlternates(origin, location.pathname),
    ...openGraph({ title: chart.title, description, url: canonical.href, locale: getLocale(), siteName: m.site_name() })];
}
export default function PublicChartDetail({ loaderData: chart }: Route.ComponentProps) {
  const location = useLocation();
  const returnState = publicListReturnState(location.state);
  const returnHref = returnState?.publicListHref;
  const canPreview = chart.summary.difficulties.some(row => row.previewSupported);
  function previewDifficulty(difficulty: ChartDifficulty) {
    if (!chart.summary.difficulties.some(row => row.difficulty === difficulty && row.previewSupported)) return;
    window.dispatchEvent(new CustomEvent("community-preview-seek", {detail:{id:chart.publicId,versionId:chart.versionId,difficulty,ms:0}}));
  }
  return <main className="community-chart-page space-y-8">
    <Link to={returnHref ?? localizeHref("/charts")} state={returnState ? publicListBackState(returnState) : undefined} className={textLinkClass}>{returnHref ? /\/me\/favorites$/.test(returnHref.split("?")[0]!) ? m.my_favorites() : /^\/(?:(?:en|ja)\/)?u\//.test(returnHref) ? m.public_chart_back_author() : m.public_chart_back_results() : m.public_charts_title()}</Link>
    <div className="community-chart-detail-hero community-panel">
      <div className="community-chart-cover-frame"><PublicCover key={`${chart.id}/${chart.versionId}`} chart={chart} /></div>
      <div className="min-w-0 space-y-3 break-words">
        <PageTitle description={chart.artist}>{chart.title}</PageTitle>
        {chart.author ? <Link to={localizeHref(`/u/${chart.author.publicId ?? chart.author.id}`)} state={returnState} className="flex items-center gap-2 underline">
          <Avatar image={chart.author.image} id={chart.author.id} name={chart.author.name} size={32} />{m.public_chart_author({ name: chart.author.name })}
        </Link> : <p>{m.public_chart_author({ name: m.public_chart_anonymous() })}</p>}
        {chart.author?.publicId ? <FollowAuthor publicId={chart.author.publicId}/> : null}
        <p className="text-sm text-muted-foreground">{m.chart_version({ number: String(chart.ordinal) })} · {(chart.sourceSize / (1024 * 1024)).toFixed(2)} MiB</p>
        <time className="block text-xs text-muted-foreground" dateTime={chart.updatedAt}>{m.public_chart_updated({ date: chart.updatedAt.slice(0, 10) })}</time>
        <div role="group" aria-label={m.public_chart_actions()} className="flex flex-wrap items-start gap-3">
          {canPreview ? <Button asChild variant="secondary" className="min-h-11"><a href="#chart-preview"><PlayCircleIcon aria-hidden="true" />{m.public_chart_preview_action()}</a></Button> : null}
          <Button asChild className="min-h-11"><a href={publicChartDownloadUrl(chart.publicId)} download><DownloadIcon aria-hidden="true" />{m.public_chart_download()}</a></Button>
          <DownloadAddButton publicIds={[chart.publicId]}/>
          <ShareChartButton key={chart.id} title={chart.title} publicId={chart.publicId} />
        </div>
        <ChartCommunityActions chart={chart} />
        <details className="community-source-details"><summary>{m.ui_source_details()}</summary><p>{m.chart_publication_version_id({id:chart.versionId})}</p><p className="mt-2">{m.public_chart_download_hint()}</p></details>
        {!canPreview ? <p className="text-sm text-muted-foreground">{m.public_chart_preview_unavailable()}</p> : null}
      </div>
    </div>
    <nav aria-label={m.ui_content_navigation()} className="community-content-nav">{[["chart-preview",m.public_chart_preview()],["chart-information",m.ui_chart_overview()],["chart-difficulties",m.chart_difficulties()],["chart-discussion",m.discussion_comments()],["chart-recommendations",m.ui_chart_recommendations()]].map(([id,label])=><a key={id} href={`#${id}`}>{label}</a>)}</nav>
    {chart.shareInvalid?<p role="status">{m.discovery_share_invalid()}</p>:null}
    <PrivateChartPreview enableShare initialDifficulty={chart.share?.difficulty} initialPosition={chart.share?.seconds??0} sectionId="chart-preview" key={`${chart.id}/${chart.versionId}/${chart.share?.difficulty??""}/${chart.share?.seconds??""}`} id={chart.publicId} versionId={chart.versionId} summary={chart.summary} assetUrl={publicChartAssetUrl} />
    <section id="chart-information" aria-label={m.chart_metadata_heading()} className="community-panel space-y-5"><h2 className="community-section-title">{m.ui_chart_overview()}</h2>
      <PublicChartTags tags={chart.tags} />
      {!chart.tags.length&&!chart.aliases?.length&&!chart.description&&!chart.credits&&!chart.releaseNote?<p className="text-sm text-muted-foreground">{m.ui_chart_information_empty()}</p>:null}
      {chart.aliases?.length?<p className="break-words text-sm">{m.discovery_aliases()}: {chart.aliases.join(" · ")}</p>:null}
      {chart.description ? <div><h2 className="font-semibold">{m.chart_metadata_description()}</h2><p className="whitespace-pre-wrap break-words">{chart.description}</p></div> : null}
      {chart.credits ? <div><h2 className="font-semibold">{m.chart_metadata_credits()}</h2><p className="whitespace-pre-wrap break-words">{chart.credits}</p></div> : null}
      {chart.releaseNote ? <div><h2 className="font-semibold">{m.chart_metadata_release_note()}</h2><p className="whitespace-pre-wrap break-words">{chart.releaseNote}</p></div> : null}
    </section>
    <section id="chart-difficulties" className="community-panel space-y-4"><div><h2 className="community-section-title">{m.chart_difficulties()}</h2><p className="mt-1 text-sm text-muted-foreground">{m.ui_chart_difficulty_hint()}</p></div><ChartSummary summary={chart.summary} onPreview={previewDifficulty}/></section>
    <ChartDiscussion chartId={chart.publicId} versionId={chart.versionId} summary={chart.summary}/>
    <section id="chart-recommendations" className="space-y-4" aria-label={m.chart_metadata_related()}><h2 className="font-semibold">{m.chart_metadata_related()}</h2>
      {chart.related?.length ? <ul className={PUBLIC_CHART_GRID_CLASS}>{chart.related.map(item => <li key={item.id}><PublicChartCard chart={item} headingLevel={3} /></li>)}</ul> : chart.related === null ? <p role="status">{m.chart_metadata_related_unavailable()}</p> : chart.author ? <Link className={textLinkClass} to={localizeHref(`/u/${chart.author.publicId ?? chart.author.id}`)}>{m.public_chart_back_author()}</Link> : null}
    </section>
    {chart.other===null?<p role="status">{m.discovery_unavailable()}</p>:chart.other?.length?<section className="space-y-3"><h2 className="font-semibold">{m.discovery_other_works()}</h2><ul className={PUBLIC_CHART_GRID_CLASS}>{chart.other.map(c=><li key={c.publicId}><PublicChartCard chart={c} headingLevel={3}/></li>)}</ul></section>:null}
    {chart.lists===null?<p role="status">{m.discovery_unavailable()}</p>:chart.lists?.length?<section className="space-y-3"><h2 className="font-semibold">{m.discovery_containing_lists()}</h2><ul className="grid gap-3 sm:grid-cols-2">{chart.lists.map(l=><li key={l.publicId}><PublicListCard list={l}/></li>)}</ul></section>:null}
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
