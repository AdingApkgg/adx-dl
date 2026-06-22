import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LayersIcon,
  SparklesIcon,
} from "lucide-react";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { AdxDownloadButton } from "@/components/site/adx-download-button";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { CatalogBrowser } from "@/components/site/catalog-browser";
import { ChartCard } from "@/components/site/chart-card";
import { ChartComments } from "@/components/site/chart-comments";
import { ChartMediaPlayer } from "@/components/site/chart-media-player";
import { ChartPreviewIsland } from "@/components/chart-preview/chart-preview-island";
import { ChartPageViews } from "@/components/site/page-view-counter";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { EntryAssetBadges } from "@/components/site/entry-asset-badges";
import { EntryCover } from "@/components/site/entry-cover";
import { GenreBadge } from "@/components/site/genre-badge";
import { HomeHeroSearch } from "@/components/site/home-hero-search";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { VersionBadge } from "@/components/site/version-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { type Catalog, type CatalogEntry } from "@/lib/catalog";
import {
  buildChartDescription,
  DIFFICULTY_DOT_CLASS,
  difficultySlotLabel,
  difficultyTone,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  GENRES,
  genreLabel,
  getChartAssetFiles,
  resolveGenreId,
  sortByReleaseDesc,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { cn } from "@/lib/utils";
import {
  MAIMAI_VERSIONS,
  VERSION_IMAGE_DIMENSIONS,
  versionImageIndex,
  versionImageSrcByIndex,
} from "@/lib/version-image";
import {
  buildChartDetailStructuredData,
  buildHomeFaqStructuredData,
  buildHomeStructuredData,
  buildListingStructuredData,
} from "@/lib/structured-data";

type SharedViewProps = {
  locale?: Locale;
};

type HomePageViewProps = SharedViewProps & {
  catalog: Catalog;
};

type CatalogPageViewProps = SharedViewProps & {
  entries: CatalogEntry[];
  title: string;
  description: string;
  intro: string;
};

type ChartDetailPageViewProps = SharedViewProps & {
  entry: CatalogEntry;
};

// FNV-1a hash: turn the catalog timestamp into a stable seed so the spotlight
// and random picks stay fixed within a build but rotate when the catalog updates.
function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Deterministic Fisher-Yates shuffle driven by a mulberry32 PRNG, so the same
// seed always yields the same order (required for a stable static export).
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = items.slice();
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The hero's "today's pick": a larger featured card with a big cover, sitting
// beside the search column on wide screens.
function HomeSpotlightCard({
  entry,
  locale,
  label,
}: {
  entry: CatalogEntry;
  locale: Locale;
  label: string;
}) {
  const href = buildLocalePath(`/charts/${entrySlug(entry)}`, locale);
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"
    >
      <div className="relative aspect-square overflow-hidden border-b border-border/60">
        <EntryCover
          entry={entry}
          locale={locale}
          priority
          sizes="(max-width: 1024px) 100vw, 360px"
          className="h-full w-full transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-background/85 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">
          <SparklesIcon className="size-3.5 text-primary" aria-hidden="true" />
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <VersionBadge version={entry.version} label={formatEntrySubcategory(entry)} />
          <GenreBadge entry={entry} locale={locale} />
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-1 text-lg font-semibold">{formatEntryTitle(entry, locale)}</h3>
          <p className="line-clamp-1 text-sm text-muted-foreground">
            {formatEntryArtist(entry, locale)}
          </p>
        </div>
        {entry.difficulties.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {entry.difficulties.slice(0, 5).map((difficulty) => (
              <DifficultyPill key={`${entry.id}-${difficulty.slot}`} difficulty={difficulty} />
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export function HomePageView({ catalog, locale = "zh" }: HomePageViewProps) {
  const dictionary = getDictionary(locale);
  const home = dictionary.home;
  const latestEntries = sortByReleaseDesc(catalog.entries).slice(0, 8);
  const versionCount = new Set(Object.values(catalog.categories).flat()).size;
  const artistCount = new Set(
    catalog.entries.map((entry) => entry.artist.trim()).filter(Boolean)
  ).size;
  const updatedDate = catalog.generated_at.slice(0, 10);
  const faqItems = home.faq(catalog.total_entries, versionCount);
  const searchHref = buildLocalePath("/charts", locale);
  const versionsHref = buildLocalePath("/versions", locale);

  // "Browse by version" teaser: newest first, only versions that have charts.
  const versionCharts = new Map<number, number>();
  for (const entry of catalog.entries) {
    const index = versionImageIndex(entry.version);
    if (index === null) continue;
    versionCharts.set(index, (versionCharts.get(index) ?? 0) + 1);
  }
  const versionTiles = [...MAIMAI_VERSIONS]
    .reverse()
    .map((version) => ({ ...version, count: versionCharts.get(version.index) ?? 0 }))
    .filter((version) => version.count > 0)
    .slice(0, 8);

  const countUnit = locale === "zh" ? "首" : locale === "ja" ? "曲" : "charts";
  const stats = [
    { label: home.metricsTotal, value: `${catalog.total_entries}` },
    { label: home.metricsVersions, value: `${versionCount}` },
    { label: home.metricsArtists, value: `${artistCount}` },
    { label: home.metricsUpdated, value: updatedDate },
  ];

  // Genre quick-filter chips for the hero search: only genres present in the
  // catalog, ordered by their stable id. Each deep-links to ?genre=.
  const heroGenreIds = new Set<number>();
  for (const entry of catalog.entries) {
    const id = resolveGenreId(entry);
    if (id !== null) heroGenreIds.add(id);
  }
  const heroGenres = [...heroGenreIds]
    .sort((a, b) => a - b)
    .map((id) => ({ id, label: GENRES[id][locale], badge: GENRES[id].badge }));

  // Spotlight + "random picks" rail: a build-stable shuffle seeded by the
  // catalog timestamp, so the selection rotates whenever the catalog updates.
  // Prefer entries that actually have cover art for the big featured card.
  const seed = seedFromString(catalog.generated_at);
  const coveredEntries = catalog.entries.filter((entry) => entry.media.cover_url);
  const shuffled = seededShuffle(
    coveredEntries.length >= 9 ? coveredEntries : catalog.entries,
    seed
  );
  const spotlight = shuffled[0] ?? null;
  const latestIds = new Set(latestEntries.map((entry) => entry.id));
  const featuredEntries = shuffled
    .filter((entry) => entry.id !== spotlight?.id && !latestIds.has(entry.id))
    .slice(0, 8);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={[
          buildHomeStructuredData(locale),
          buildHomeFaqStructuredData(locale, catalog.total_entries, versionCount),
        ]}
      />
      <section className="relative isolate overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/10 via-card/50 to-fuchsia-500/10 px-6 py-12 md:px-12 md:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-24 -left-24 size-[420px] rounded-full bg-primary/25 blur-3xl" />
          <div className="absolute -bottom-32 right-0 size-[380px] rounded-full bg-fuchsia-500/20 blur-3xl" />
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            <Badge variant="secondary" className="w-fit">
              {home.badge}
            </Badge>
            <h1 className="bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500 bg-clip-text text-4xl leading-tight font-bold text-transparent md:text-5xl">
              {home.title}
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
              {home.description}
            </p>
            <HomeHeroSearch
              searchHref={searchHref}
              placeholder={dictionary.catalogBrowser.searchPlaceholder}
              submitLabel={home.searchCta}
              quickLabel={home.quickGenresLabel}
              genres={heroGenres}
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button variant="outline" size="sm" asChild>
                <Link href={versionsHref}>
                  <LayersIcon data-icon="inline-start" aria-hidden="true" />
                  {home.browseCta}
                </Link>
              </Button>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {stats.map((stat) => (
                  <div key={stat.label} className="flex items-baseline gap-1.5">
                    <dt>{stat.label}</dt>
                    <dd className="font-semibold tabular-nums text-foreground">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          {spotlight ? (
            <div className="mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none">
              <HomeSpotlightCard entry={spotlight} locale={locale} label={home.spotlightLabel} />
            </div>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <Reveal className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">{home.branchesTitle}</h2>
            <p className="text-sm text-muted-foreground">{home.branchesDescription}</p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href={versionsHref}>
              {home.versionsCta}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </Reveal>
        <RevealGroup className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {versionTiles.map((version) => (
            <RevealItem key={version.index} className="h-full">
              <Link
                href={buildLocalePath(`/versions/${version.slug}`, locale)}
                className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/70 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
              >
                <Image
                  src={versionImageSrcByIndex(version.index)}
                  alt={version.name}
                  width={VERSION_IMAGE_DIMENSIONS.width}
                  height={VERSION_IMAGE_DIMENSIONS.height}
                  unoptimized
                  className="h-14 w-auto drop-shadow transition-transform duration-300 group-hover:scale-105"
                />
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className="line-clamp-1 text-sm font-medium">{version.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {version.count} {countUnit}
                  </span>
                </div>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      <section className="flex flex-col gap-5">
        <Reveal className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">{home.latestTitle}</h2>
            <p className="text-sm text-muted-foreground">{home.latestDescription}</p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href={searchHref}>
              {home.viewMore}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </Reveal>
        <RevealGroup className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {latestEntries.map((entry, index) => (
            <RevealItem key={entry.id} className="h-full">
              <ChartCard
                entry={entry}
                locale={locale}
                priority={index < 4}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              />
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      {featuredEntries.length > 0 ? (
        <section className="flex flex-col gap-5">
          <Reveal className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold">{home.featuredTitle}</h2>
              <p className="text-sm text-muted-foreground">{home.featuredDescription}</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={searchHref}>
                {home.viewMore}
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </Reveal>
          <RevealGroup className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {featuredEntries.map((entry) => (
              <RevealItem key={entry.id} className="h-full">
                <ChartCard
                  entry={entry}
                  locale={locale}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              </RevealItem>
            ))}
          </RevealGroup>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <Reveal>
          <h2 className="text-2xl font-semibold">{home.faqHeading}</h2>
        </Reveal>
        <RevealGroup className="grid gap-4 md:grid-cols-2">
          {faqItems.map((item) => (
            <RevealItem key={item.q} className="h-full">
              <Card size="sm" className="h-full border border-border/70 bg-card/85">
                <CardHeader>
                  <CardTitle asChild>
                    <h3 className="text-base font-medium">{item.q}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{item.a}</p>
                </CardContent>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>
    </main>
  );
}

export function ChartsPageView({
  entries,
  locale = "zh",
}: SharedViewProps & { entries: CatalogEntry[] }) {
  const dictionary = getDictionary(locale);
  const versionCount = new Set(entries.map((entry) => formatEntrySubcategory(entry))).size;

  return (
    <CatalogPageView
      entries={entries}
      locale={locale}
      title={dictionary.charts.title}
      description={dictionary.charts.description}
      intro={dictionary.charts.intro(entries.length, versionCount)}
    />
  );
}

export function ChartDetailPageView({
  entry,
  locale = "zh",
}: ChartDetailPageViewProps) {
  const dictionary = getDictionary(locale);
  const detail = dictionary.detail;
  const branchLabel = formatEntrySubcategory(entry);
  const description = buildChartDescription(entry, locale);

  // Files packed into the downloaded .adx, named as the AstroDX app expects.
  const downloadFiles = getChartAssetFiles(entry);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildChartDetailStructuredData(locale, entry)} />
      <section className="relative isolate overflow-hidden rounded-3xl border border-border/60">
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          {entry.media.cover_url ? (
            <>
              <Image
                src={entry.media.cover_url}
                alt=""
                fill
                unoptimized
                sizes="100vw"
                className="scale-110 object-cover opacity-30 blur-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/55" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-card/40 to-fuchsia-500/10" />
          )}
        </div>

        <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[260px] lg:mx-0">
            <div className="aspect-square overflow-hidden rounded-2xl border border-border/60 shadow-xl">
              <EntryCover
                entry={entry}
                locale={locale}
                priority
                sizes="(max-width: 1024px) 260px, 260px"
                className="h-full w-full"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <VersionBadge version={entry.version} label={branchLabel} />
              <CabinetBadge cabinet={entry.cabinet} className="h-7" />
              <GenreBadge entry={entry} locale={locale} />
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold md:text-5xl">{formatEntryTitle(entry, locale)}</h1>
              <p className="text-lg text-muted-foreground">{formatEntryArtist(entry, locale)}</p>
              <ChartPageViews label={dictionary.pageViews.pageViews} />
            </div>
            {entry.difficulties.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {entry.difficulties.map((difficulty) => (
                  <DifficultyPill key={`${entry.id}-${difficulty.slot}`} difficulty={difficulty} />
                ))}
              </div>
            ) : null}
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {description}
            </p>
            <div className="flex flex-wrap gap-2">
              <EntryAssetBadges entry={entry} locale={locale} />
            </div>
            <div className="flex flex-wrap gap-2">
              {entry.download_mode === "onsite" || entry.download_mode === "mixed" ? (
                <AdxDownloadButton
                  files={downloadFiles}
                  fileName={entry.remote_dir_name}
                  locale={locale}
                />
              ) : (
                <Button disabled>
                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  {detail.onsitePending}
                </Button>
              )}
              {(entry.download_mode === "external" || entry.download_mode === "mixed") &&
              entry.source_url ? (
                <Button variant="outline" asChild>
                  <a href={entry.source_url} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />
                    {detail.sourceLink}
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Reveal>
        <ChartMediaPlayer entry={entry} locale={locale} />
      </Reveal>

      {entry.files.maidata ? (
        <Reveal>
          <Card>
            <CardHeader>
              <CardTitle>{detail.chartPreview}</CardTitle>
              <CardDescription>{detail.chartPreviewDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartPreviewIsland
                maidataUrl={entry.files.maidata}
                audioUrl={entry.media.audio_url || undefined}
                videoUrl={entry.media.pv_url || entry.files.pv || undefined}
                chartName={`${entry.short_id || entry.id}-${formatEntryTitle(entry, locale)}`}
                locale={locale}
                levels={Object.fromEntries(entry.difficulties.map((d) => [d.slot, d.level]))}
                defaultDifficulty={
                  entry.difficulties.length > 0
                    ? Math.max(...entry.difficulties.map((d) => d.slot))
                    : undefined
                }
              />
            </CardContent>
          </Card>
        </Reveal>
      ) : null}

      <Reveal className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{detail.metadata}</CardTitle>
            <CardDescription>{detail.metadataDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <MetadataItem label={detail.versionLabel} value={entry.version || detail.unknownValue} />
              <MetadataItem
                label={detail.genreLabel}
                value={genreLabel(entry, locale) || detail.unknownValue}
              />
              <MetadataItem
                label={detail.bpmLabel}
                value={entry.bpm ? `${entry.bpm}` : detail.unknownValue}
              />
              <MetadataItem
                label={detail.shortIdLabel}
                value={entry.short_id || detail.notAvailableValue}
              />
            </div>
            {entry.aliases && entry.aliases.length > 0 ? (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {detail.aliasesLabel}
                  </h2>
                  <ul className="flex flex-wrap gap-1.5">
                    {entry.aliases.map((alias) => (
                      <li
                        key={alias}
                        className="rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-xs text-foreground/80"
                      >
                        {alias}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}
            <Separator />
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{detail.difficulties}</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    {formatEntryTitle(entry, locale)} — {detail.difficulties}
                  </caption>
                  <thead>
                    <tr className="border-b border-border/60 text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {detail.tableDifficulty}
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {detail.tableLevel}
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        {detail.tableCharter}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.difficulties.map((difficulty) => (
                      <tr
                        key={`${entry.id}-${difficulty.slot}`}
                        className="border-b border-border/40 last:border-0"
                      >
                        <th scope="row" className="py-2 pr-4 text-left font-medium">
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={cn(
                                "size-2.5 rounded-full",
                                DIFFICULTY_DOT_CLASS[difficultyTone(difficulty)]
                              )}
                            />
                            {difficultySlotLabel(difficulty)}
                          </span>
                        </th>
                        <td className="py-2 pr-4">
                          <DifficultyPill difficulty={difficulty} />
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {difficulty.designer || detail.unknownValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{detail.assets}</CardTitle>
              <CardDescription>{detail.assetsDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <EntryAssetBadges entry={entry} locale={locale} />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>{detail.source}</CardTitle>
              <CardDescription>{detail.sourceDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
              <p className="break-all">{entry.source_url}</p>
              <p className="break-all">
                {entry.files.maidata || entry.files.maidata_dx || entry.remote_dir_name}
              </p>
              <p className="break-words">{entry.license_note}</p>
            </CardContent>
          </Card>
        </div>
      </Reveal>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{detail.comments}</h2>
        <ChartComments
          pageKey={`/charts/${entrySlug(entry)}`}
          pageTitle={formatEntryTitle(entry, locale)}
          locale={locale}
        />
      </section>
    </main>
  );
}

function CatalogPageView({
  entries,
  locale = "zh",
  title,
  description,
  intro,
}: CatalogPageViewProps) {
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildListingStructuredData(locale, entries)} />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </Reveal>
      <CatalogBrowser
        entries={entries}
        locale={locale}
        detailPathPrefix={buildLocalePath("/charts", locale)}
      />
    </main>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-medium">{value}</p>
    </div>
  );
}
