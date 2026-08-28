import Link from "next/link";
import { preload } from "react-dom";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LifeBuoyIcon,
  PlayCircleIcon,
} from "lucide-react";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { AdxDownloadButton } from "@/components/site/adx-download-button";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { CatalogBrowser } from "@/components/site/catalog-browser";
import {
  ChartCard,
  CHART_CARD_SIZES,
  CHART_GRID_CLASS,
} from "@/components/site/chart-card";
import {
  ChartDetailActions,
  PreviewDifficultyTrigger,
} from "@/components/site/chart-detail-actions";
import {
  CompatibleImage,
  compatibleSourcesFromPng,
} from "@/components/site/compatible-image";
import {
  DetailHeroBackdrop,
  DetailHeroCover,
  RelatedChartRow,
} from "@/components/site/detail-hero-parallax";
import { ChartPageViews } from "@/components/site/page-view-counter";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { EntryAssetBadges } from "@/components/site/entry-asset-badges";
import { EntryCover } from "@/components/site/entry-cover";
import { GenreBadge } from "@/components/site/genre-badge";
import { HeroStatNumber } from "@/components/site/hero-aurora";
import { HomeFaq } from "@/components/site/home-faq";
import { HomeHeroSearch } from "@/components/site/home-hero-search";
import styles from "@/components/site/home-page.module.css";
import { HomeSpotlightCarousel } from "@/components/site/home-spotlight-carousel";
import { RandomChartButton } from "@/components/site/random-chart-button";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { VersionBadge } from "@/components/site/version-badge";
import { VersionTileCard } from "@/components/site/version-tile-card";
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
  bpmBucketId,
  BPM_TONE,
  buildChartDescription,
  chartBpmDisplay,
  DIFFICULTY_DOT_CLASS,
  difficultySlotLabel,
  difficultyTone,
  formatChartDuration,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  GENRES,
  genreFilterQuery,
  getChartDownloadSpec,
  localChartAssetUrl,
  isRecentImport,
  peakNoteDifficulty,
  resolveGenreId,
  resolveVersionIndex,
  sortByImportedDesc,
  sumChartDownloadBytes,
  UTAGE_CABINET,
  UTAGE_GENRE_ID,
  type CatalogNoteCounts,
} from "@/lib/catalog-shared";
import { formatBytes } from "@/components/site/downloads/format-bytes";
import { seedFromString, selectFeatured } from "@/lib/featured-selection";
import { buildVersionFilterHref } from "@/lib/catalog-links";
import {
  astroDxDownloadUrl,
  CHART_IMPORT_VIDEO_URL,
  DEMO_VIDEO_URL,
} from "@/lib/resource-links";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { japaneseTextLang } from "@/lib/text-lang";
import { cn } from "@/lib/utils";
import { MAIMAI_VERSIONS } from "@/lib/version-image";
import {
  buildCatalogDatasetStructuredData,
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
  /** Sibling charts (same artist/genre/version) for the "related" cross-link rail. */
  related?: CatalogEntry[];
};

// Build-day seed inputs, evaluated ONCE at module init (= SSG build time; also
// keeps impure Date calls out of render for react-hooks/purity). The daily
// scheduled rebuild gives this a fresh value each day; the reference timestamp
// derives from the same day string so recency weights are day-stable too.
const BUILD_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
const BUILD_DAY_MS = Date.parse(`${BUILD_DAY}T00:00:00+08:00`);

// Cards per home rail ("latest" and "random picks"). 12 is the one size that
// fills whole rows at every step of CHART_GRID_CLASS (2 / 3 / 4 / 6 columns),
// and it matches CHANGELOG_PREVIEW_SIZE, which the "latest" rail is a preview
// of. Anything not divisible by 4 leaves a ragged row on lg screens.
const HOME_RAIL_SIZE = 12;

function HomeHeroTitle({ title, noBreak }: { title: string; noBreak?: string }) {
  if (!noBreak) return title;

  const phraseStart = title.indexOf(noBreak);
  if (phraseStart < 0) return title;

  return (
    <>
      {title.slice(0, phraseStart)}
      <span className={styles.heroTitleNoBreak}>{noBreak}</span>
      {title.slice(phraseStart + noBreak.length)}
    </>
  );
}

export function HomePageView({ catalog, locale = "zh" }: HomePageViewProps) {
  const dictionary = getDictionary(locale);
  const home = dictionary.home;
  // "Latest" means what this archive added last, not which maimai era a song
  // shipped in — sortByReleaseDesc answers the second question and left the
  // rail static between imports of older-version charts.
  const latestEntries = sortByImportedDesc(catalog.entries).slice(0, HOME_RAIL_SIZE);
  const versionCount = new Set(Object.values(catalog.categories).flat()).size;
  const artistCount = new Set(
    catalog.entries.map((entry) => entry.artist.trim()).filter(Boolean)
  ).size;
  const updatedDate = catalog.generated_at.slice(0, 10);
  const faqItems = home.faq(catalog.total_entries, versionCount);
  const searchHref = buildLocalePath("/charts", locale);
  const versionsHref = buildLocalePath("/versions", locale);
  const changelogHref = buildLocalePath("/changelog", locale);
  const guideHref = buildLocalePath("/guide", locale);

  // "Browse by version" teaser: newest first, only versions that have charts.
  const versionCharts = new Map<number, number>();
  for (const entry of catalog.entries) {
    const index = resolveVersionIndex(entry);
    if (index === null) continue;
    versionCharts.set(index, (versionCharts.get(index) ?? 0) + 1);
  }
  const versionTiles = [...MAIMAI_VERSIONS]
    .reverse()
    .map((version) => ({ ...version, count: versionCharts.get(version.index) ?? 0 }))
    .filter((version) => version.count > 0)
    .slice(0, 6);

  // Numeric stats count up after hydration (RollingNumber keeps the real value
  // in the SSR HTML); the updated date stays a static string.
  const stats: { label: string; value: number | string }[] = [
    { label: home.metricsTotal, value: catalog.total_entries },
    { label: home.metricsVersions, value: versionCount },
    { label: home.metricsArtists, value: artistCount },
    { label: home.metricsUpdated, value: updatedDate },
  ];

  // Genre browse cards: only genres present in the catalog, ordered by their
  // stable id. Each deep-links to a pre-filtered catalog view.
  const heroGenreIds = new Set<number>();
  for (const entry of catalog.entries) {
    const id = resolveGenreId(entry);
    if (id !== null) heroGenreIds.add(id);
  }
  const genreTiles = [...heroGenreIds].sort((a, b) => a - b).map((id) => ({
    id,
    label: GENRES[id][locale],
    badge: GENRES[id].badge,
    // 宴会場 resolves to the Type row's UTAGE chip, not a genre chip — see
    // genreFilterQuery. Linking it as ?genre=107 lands on a filtered grid with
    // no chip lit anywhere in the panel.
    href: `${searchHref}?${genreFilterQuery(id)}`,
  }));

  // Spotlight carousel + "random picks" rail: deterministic weighted picks
  // seeded by the BUILD DAY (Asia/Shanghai) — the daily scheduled rebuild in
  // deploy-gh-pages.yml rotates the selection once a day, and any re-deploy
  // within the same day reproduces it. Weights favor fresh imports, covers,
  // PVs and the newest version; constraints spread versions and difficulty
  // bands (see lib/featured-selection.ts).
  const latestIds = new Set(latestEntries.map((entry) => entry.id));
  const { spotlight: spotlightEntries, featured: featuredEntries } = selectFeatured(
    catalog.entries,
    {
      seed: seedFromString(BUILD_DAY),
      referenceMs: BUILD_DAY_MS,
      featuredCount: HOME_RAIL_SIZE,
      excludeFromFeatured: latestIds,
    }
  );
  const firstSpotlight = spotlightEntries[0] ?? null;
  // Preload the above-the-fold spotlight cover — the home LCP element. It renders
  // as a raw <img> (static export makes next/image unoptimized), so nothing else
  // emits a head preload. Prefer the optimized AVIF and type-gate it so non-AVIF
  // browsers (which fetch the webp/original instead) don't double-download.
  if (firstSpotlight?.media.cover_avif || firstSpotlight?.media.cover_url) {
    const avif = firstSpotlight.media.cover_avif;
    preload(avif || firstSpotlight.media.cover_url, {
      as: "image",
      fetchPriority: "high",
      ...(avif ? { type: "image/avif" } : {}),
    });
  }
  return (
    <main
      id="main-content"
      className={cn(
        "mx-auto flex w-full max-w-[82rem] flex-col gap-12 px-4 py-6 md:gap-16 md:px-6 md:py-10",
        styles.page
      )}
    >
      <SeoJsonLd
        data={[
          buildHomeStructuredData(locale, catalog),
          buildHomeFaqStructuredData(locale, catalog.total_entries, versionCount),
          buildCatalogDatasetStructuredData(locale, catalog.generated_at),
        ]}
      />
      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          {/* Copy comes first in the DOM so mobile reading and focus order match the layout. */}
          <div className={styles.heroContent}>
            <div className={styles.brandLockup}>
              <CompatibleImage
                sources={compatibleSourcesFromPng("/brand-icon.png")}
                alt=""
                width={40}
                height={40}
                className={styles.brandMark}
              />
              <span className={styles.brandCopy}>
                <span className={styles.brandName}>ADX CHARTS</span>
                <span className={styles.brandMeta}>ASTRODX COMMUNITY LIBRARY</span>
              </span>
            </div>
            <span className={styles.eyebrow}>{home.badge}</span>
            <h1 className={styles.heroTitle}>
              <HomeHeroTitle title={home.heroTitle} noBreak={home.heroTitleNoBreak} />
            </h1>
            <p className={styles.heroDescription}>{home.heroDescription}</p>
            <div className={styles.heroSearch}>
              <HomeHeroSearch
                searchHref={searchHref}
                placeholder={dictionary.catalogBrowser.searchPlaceholder}
                submitLabel={home.searchCta}
                tone="brand"
              />
            </div>
            <div
              className={styles.heroActions}
              role="group"
              aria-label={home.heroActionsLabel}
            >
              <a
                className={cn(styles.heroAction, styles.heroActionPrimary)}
                href={astroDxDownloadUrl(locale)}
                target="_blank"
                rel="noreferrer"
              >
                {home.getAppCta}
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </a>
              <Link className={styles.heroAction} href={guideHref}>
                {home.guideCta}
                <LifeBuoyIcon className="size-3.5" aria-hidden="true" />
              </Link>
              <a
                className={styles.heroAction}
                href={CHART_IMPORT_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
              >
                {home.importVideoCta}
                <PlayCircleIcon className="size-3.5" aria-hidden="true" />
              </a>
              <Link className={styles.heroAction} href={versionsHref}>
                {home.browseCta}
                <ChevronRightIcon className="size-3.5" aria-hidden="true" />
              </Link>
              <a
                className={styles.heroAction}
                href={DEMO_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
              >
                {home.videoCta}
                <PlayCircleIcon className="size-3.5" aria-hidden="true" />
              </a>
              <RandomChartButton
                locale={locale}
                label={home.randomCta}
                className={cn(styles.heroAction, styles.randomButton)}
              />
              {/* Points at the question itself, not at the section: `#faq`
                  scrolled to a heading with five collapsed rows under it. */}
              <a className={styles.heroAction} href={`#${home.faqEntryId}`}>
                {home.whatIsAstroDX}
                <ChevronRightIcon className="size-3.5" aria-hidden="true" />
              </a>
            </div>
            <dl className={styles.heroMetrics}>
              {stats.map((stat) => (
                <div key={stat.label} className={styles.heroMetric}>
                  <dt>{stat.label}</dt>
                  <dd>
                    {typeof stat.value === "number" ? (
                      <HeroStatNumber value={stat.value} />
                    ) : (
                      stat.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={styles.spotlightColumn}>
            {spotlightEntries.length > 0 ? (
              <HomeSpotlightCarousel entries={spotlightEntries} locale={locale} />
            ) : (
              <div className={styles.spotlightFallback} aria-hidden="true">
                <CompatibleImage
                  sources={compatibleSourcesFromPng("/brand-icon.png")}
                  alt=""
                  width={192}
                  height={192}
                  className="h-full w-full object-contain"
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <div className={styles.section}>
        <div className={styles.browsePanel}>
          <section className={styles.browseColumn}>
            <Reveal className={cn(styles.sectionHeader, styles.browseColumnHeader)}>
              <div className={styles.sectionHeadingGroup}>
                <span className={styles.sectionIndex}>01</span>
                <div>
                  <h2 className={styles.sectionTitle}>{home.branchesTitle}</h2>
                  <p className={styles.sectionDescription}>{home.branchesDescription}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href={versionsHref}>
                  {home.versionsCta}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </Reveal>
            <RevealGroup
              as="ul"
              role="list"
              className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3"
            >
              {versionTiles.map((version) => (
                <RevealItem as="li" key={version.index} ssrVisible className="h-full">
                  <Link
                    href={buildVersionFilterHref(version.index, locale)}
                    className="group/version block h-full rounded-xl transition-transform hover:-translate-y-0.5"
                  >
                    <VersionTileCard
                      name={version.name}
                      imageIndex={version.index}
                      count={version.count}
                      locale={locale}
                    />
                  </Link>
                </RevealItem>
              ))}
            </RevealGroup>
          </section>

          <section className={styles.browseColumn}>
            <Reveal className={cn(styles.sectionHeader, styles.browseColumnHeader)}>
              <div className={styles.sectionHeadingGroup}>
                <span className={styles.sectionIndex}>02</span>
                <div>
                  <h2 className={styles.sectionTitle}>{home.quickGenresLabel}</h2>
                  <p className={styles.sectionDescription}>{home.genresDescription}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href={searchHref}>
                  {home.viewMore}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </Reveal>
            <RevealGroup
              as="ul"
              role="list"
              className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3"
            >
              {genreTiles.map((genre) => (
                <RevealItem as="li" key={genre.id} ssrVisible className="h-full">
                  <Link
                    href={genre.href}
                    className={cn(styles.genreBrowseCard, genre.badge)}
                  >
                    <span className={styles.genreBrowseLabel}>{genre.label}</span>
                    <ArrowRightIcon aria-hidden="true" />
                  </Link>
                </RevealItem>
              ))}
            </RevealGroup>
          </section>
        </div>
      </div>

      <section className={styles.section}>
        <Reveal className={styles.sectionHeader}>
          <div className={styles.sectionHeadingGroup}>
            <span className={styles.sectionIndex}>03</span>
            <div>
              <h2 className={styles.sectionTitle}>{home.latestTitle}</h2>
              <p className={styles.sectionDescription}>{home.latestDescription}</p>
            </div>
          </div>
          {/* The rail shows one page of an import batch; /changelog is where
              the rest of that batch — and every earlier one — lives. */}
          <Button variant="ghost" size="sm" asChild>
            <Link href={changelogHref}>
              {home.viewMore}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </Reveal>
        <RevealGroup
          as="ul"
          role="list"
          className={CHART_GRID_CLASS}
        >
          {latestEntries.map((entry) => (
            <RevealItem as="li" key={entry.id} ssrVisible className="h-full">
              <ChartCard
                entry={entry}
                locale={locale}
                coverFit="contain"
                isNew={isRecentImport(entry.imported_at, catalog.generated_at)}
                sizes={CHART_CARD_SIZES}
              />
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      {featuredEntries.length > 0 ? (
        <section className={styles.section}>
          <Reveal className={styles.sectionHeader}>
            <div className={styles.sectionHeadingGroup}>
              <span className={styles.sectionIndex}>04</span>
              <div>
                <h2 className={styles.sectionTitle}>{home.featuredTitle}</h2>
                <p className={styles.sectionDescription}>{home.featuredDescription}</p>
              </div>
            </div>
            <div className={styles.discoveryActions}>
              <RandomChartButton locale={locale} label={home.randomCta} />
              <Button variant="ghost" size="sm" asChild>
                <Link href={searchHref}>
                  {home.viewMore}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </Reveal>
          <RevealGroup
            as="ul"
            role="list"
            className={CHART_GRID_CLASS}
          >
            {featuredEntries.map((entry) => (
              <RevealItem as="li" key={entry.id} ssrVisible className="h-full">
                <ChartCard
                  entry={entry}
                  locale={locale}
                  coverFit="contain"
                  sizes={CHART_CARD_SIZES}
                />
              </RevealItem>
            ))}
          </RevealGroup>
        </section>
      ) : null}

      <section className={styles.section}>
        <Reveal ssrVisible className={styles.sectionHeader}>
          <div className={styles.sectionHeadingGroup}>
            <span className={styles.sectionIndex}>05</span>
            <div>
              <h2 id="faq" className={cn("scroll-mt-24", styles.sectionTitle)}>
                {home.faqHeading}
              </h2>
            </div>
          </div>
        </Reveal>
        <HomeFaq items={faqItems} />
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

// EntryCover types its prop as the full CatalogEntry but a related-card thumb
// only renders the cover media plus the title/branch placeholder text. EntryCover
// is a client component, so whatever object we hand it is serialized into the
// page's RSC payload — blank the heavy download/source fields so a dozen sibling
// entries don't bloat every statically exported detail page.
function toRelatedCoverEntry(item: CatalogEntry): CatalogEntry {
  return {
    id: item.id,
    remote_dir_name: "",
    title: item.title,
    ...(item.title_en ? { title_en: item.title_en } : {}),
    artist: "",
    category: item.category,
    subcategory: item.subcategory,
    source_archive: "",
    source_folder: "",
    version: item.version,
    genre: "",
    cabinet: item.cabinet,
    short_id: "",
    bpm: null,
    offset: null,
    download_mode: "onsite",
    download_url: "",
    source_url: "",
    license_note: "",
    files: { maidata: "", maidata_dx: "", audio: "", background: "", pv: "" },
    assets: { has_audio: false, has_background: false, has_pv: false, has_dx_chart: false },
    media: {
      entry_base_url: "",
      cover_url: item.media.cover_url,
      ...(item.media.cover_avif ? { cover_avif: item.media.cover_avif } : {}),
      ...(item.media.cover_webp ? { cover_webp: item.media.cover_webp } : {}),
      audio_url: "",
      pv_url: "",
    },
    difficulties: [],
  };
}

export function ChartDetailPageView({
  entry,
  locale = "zh",
  related = [],
}: ChartDetailPageViewProps) {
  const dictionary = getDictionary(locale);
  const detail = dictionary.detail;
  const branchLabel = formatEntrySubcategory(entry);
  const description = buildChartDescription(entry, locale);
  const title = formatEntryTitle(entry, locale);
  const chartsHref = buildLocalePath("/charts", locale);
  const heroCoverSources = entry.media.cover_url
    ? {
        avif: entry.media.cover_avif,
        webp: entry.media.cover_webp,
        png: entry.media.cover_url,
      }
    : null;

  // Metadata links reuse the catalog's stable version-id filter instead of
  // opening a separate per-version page. Older entries fall back to resolving
  // the id from their canonical version name.
  const versionIndex = resolveVersionIndex(entry);
  const versionHref = buildVersionFilterHref(versionIndex, locale);
  const genreId = resolveGenreId(entry);
  // 宴会場 has no chip in the browse genre row — it lives in the Type row as the
  // UTAGE cabinet icon, so this readout mirrors that: same image, and (via
  // genreFilterQuery) a link to the cabinet filter, whose chip does highlight.
  const isUtageGenre = genreId === UTAGE_GENRE_ID;
  const genreHref =
    genreId !== null ? `${chartsHref}?${genreFilterQuery(genreId)}` : undefined;
  // BPM links to its bucket, the same granularity the browse filter offers.
  const bpmBucket = bpmBucketId(entry.bpm);
  const bpmHref = bpmBucket !== null ? `${chartsHref}?bpm=${bpmBucket}` : undefined;
  const bpmDisplay = chartBpmDisplay(entry);
  const durationText = formatChartDuration(entry.duration_ms);

  // The artist was dead text next to three linked filter chips. `?q=` is the
  // only param that can carry a free-form name (there is no artist facet), and
  // the search index weights the artist field, so it lands on that artist's
  // charts. The charter row uses the real `?designer=` facet added with it.
  const artistName = formatEntryArtist(entry, locale).trim();
  const artistHref = artistName
    ? `${chartsHref}?q=${encodeURIComponent(artistName)}`
    : undefined;

  // Single downloads use the same global chart spec as every batch entry.
  const downloadSpec = getChartDownloadSpec(entry);
  const downloadBytes = sumChartDownloadBytes([downloadSpec]);
  const hasChartPreview = Boolean(entry.files.maidata);
  const peakDifficulty = peakNoteDifficulty(entry);
  const sourceHost = hostnameOf(entry.source_url);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildChartDetailStructuredData(locale, entry)} />
      <nav
        aria-label={detail.breadcrumbLabel}
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href={chartsHref} className="shrink-0 transition-colors hover:text-foreground">
          {dictionary.nav.browse}
        </Link>
        <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span aria-current="page" className="line-clamp-1 text-foreground">
          {title}
        </span>
      </nav>
      {/* The whole chart page is one self-contained article about the chart. */}
      <article className="flex flex-col gap-6">
      <section className="relative isolate overflow-hidden rounded-3xl border border-border/60">
        <DetailHeroBackdrop>
          {heroCoverSources ? (
            <>
              <CompatibleImage
                sources={heroCoverSources}
                alt=""
                sizes="100vw"
                pictureClassName="absolute inset-0 block"
                className="h-full w-full scale-110 object-cover opacity-30 blur-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/55" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-card/40 to-fuchsia-500/10" />
          )}
        </DetailHeroBackdrop>

        <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[260px] lg:mx-0">
            <DetailHeroCover>
              <EntryCover
                entry={entry}
                locale={locale}
                priority
                sizes="(max-width: 1024px) 260px, 260px"
                className="h-full w-full"
              />
            </DetailHeroCover>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <VersionBadge version={entry.version} label={branchLabel} />
              <CabinetBadge cabinet={entry.cabinet} className="h-7" />
              <GenreBadge entry={entry} locale={locale} />
            </div>
            <div className="flex flex-col gap-2">
              <h1
                lang={japaneseTextLang(title)}
                className="text-3xl font-bold md:text-5xl"
              >
                {title}
              </h1>
              <p lang={japaneseTextLang(artistName)} className="text-lg text-muted-foreground">
                {artistHref ? (
                  <Link
                    href={artistHref}
                    className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-current"
                  >
                    {artistName}
                  </Link>
                ) : (
                  artistName
                )}
              </p>
              <ChartPageViews label={dictionary.pageViews.pageViews} />
            </div>
            {entry.difficulties.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {entry.difficulties.map((difficulty) =>
                  hasChartPreview ? (
                    <PreviewDifficultyTrigger
                      key={`${entry.id}-${difficulty.slot}`}
                      slot={difficulty.slot}
                      label={detail.chartPreviewAt(difficultySlotLabel(difficulty))}
                    >
                      <DifficultyPill difficulty={difficulty} showConstant />
                    </PreviewDifficultyTrigger>
                  ) : (
                    <DifficultyPill
                      key={`${entry.id}-${difficulty.slot}`}
                      difficulty={difficulty}
                      showConstant
                    />
                  )
                )}
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
                <AdxDownloadButton spec={downloadSpec} locale={locale} />
              ) : (
                <Button disabled>
                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  {detail.onsitePending}
                </Button>
              )}
              <ChartDetailActions entry={entry} locale={locale} />
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

      <Reveal ssrVisible className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{detail.metadata}</CardTitle>
            <CardDescription>{detail.metadataDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Version, genre and BPM all carry the browse filter row's own
                  visuals — the version logo, the genre's colour, the BPM
                  bucket's tint — and link back into that filter. */}
              <MetadataItem label={detail.versionLabel} href={versionHref}>
                <VersionBadge
                  version={entry.version}
                  label={branchLabel || entry.version || detail.unknownValue}
                  className="h-9"
                />
              </MetadataItem>
              {/* Rendered from GENRES rather than via GenreBadge: that one
                  suppresses 宴会場 (107) because the hero's cabinet icon
                  already says so, but here it's the only genre readout. */}
              <MetadataItem label={detail.genreLabel} href={genreHref}>
                {isUtageGenre ? (
                  <CabinetBadge cabinet={UTAGE_CABINET} className="h-9" />
                ) : genreId !== null && GENRES[genreId] ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium",
                      GENRES[genreId].badge
                    )}
                  >
                    {GENRES[genreId][locale]}
                  </span>
                ) : (
                  detail.unknownValue
                )}
              </MetadataItem>
              {/* The bucket link still keys off the nominal BPM; the label may
                  widen to the measured span on a variable-tempo chart. */}
              <MetadataItem label={detail.bpmLabel} href={bpmHref}>
                {bpmDisplay && bpmBucket ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium",
                      BPM_TONE[bpmBucket]
                    )}
                  >
                    {bpmDisplay.variable
                      ? detail.bpmVariableLabel(bpmDisplay.text)
                      : bpmDisplay.text}
                  </span>
                ) : (
                  detail.unknownValue
                )}
              </MetadataItem>
              {durationText ? (
                <MetadataItem label={detail.durationLabel} value={durationText} />
              ) : null}
              <MetadataItem
                label={detail.shortIdLabel}
                value={entry.short_id || detail.notAvailableValue}
              />
            </div>
            {entry.aliases && entry.aliases.length > 0 ? (
              <>
                <Separator />
                {/* Entries average 6.5 aliases and one has 41 — all Chinese
                    community nicknames. On the zh tree that wall is the point;
                    on en/ja it was untranslatable filler sitting in the middle
                    of the page, so there it starts collapsed. `details` keeps
                    every alias in the served HTML either way (they are a real
                    search entry point), and needs no JavaScript. */}
                <details open={locale === "zh"} className="flex flex-col gap-2">
                  <summary className="cursor-pointer rounded-sm text-sm font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {detail.aliasesLabel}
                    <span className="ml-1 tabular-nums">({entry.aliases.length})</span>
                  </summary>
                  <ul lang="zh-Hans" className="mt-2 flex flex-wrap gap-1.5">
                    {entry.aliases.map((alias) => (
                      <li
                        key={alias}
                        className="rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-xs text-foreground/80"
                      >
                        {alias}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : null}
            <Separator />
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{detail.difficulties}</h2>
              {/* The table can outgrow a 390px viewport once the note column is
                  in; the scroller (not a reflow) keeps the columns aligned. */}
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
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        {detail.tableNotes}
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        {detail.tableCharter}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.difficulties.map((difficulty) => {
                      // "-" is the source's own placeholder for "unattributed"
                      // (which is why the designer facet drops it too) — it
                      // must not become a filter link that matches nothing.
                      const designer = difficulty.designer.trim();
                      const designerHref =
                        designer && designer !== "-"
                          ? `${chartsHref}?designer=${encodeURIComponent(designer)}`
                          : undefined;
                      return (
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
                            {hasChartPreview ? (
                              <PreviewDifficultyTrigger
                                slot={difficulty.slot}
                                label={detail.chartPreviewAt(difficultySlotLabel(difficulty))}
                              >
                                <DifficultyPill difficulty={difficulty} showConstant />
                              </PreviewDifficultyTrigger>
                            ) : (
                              <DifficultyPill difficulty={difficulty} showConstant />
                            )}
                          </td>
                          <td className="py-2 pr-4 align-top text-right">
                            <NoteCountCell counts={difficulty.notes} detail={detail} />
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {designerHref ? (
                              <Link
                                href={designerHref}
                                className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-current"
                              >
                                {designer}
                              </Link>
                            ) : (
                              detail.unknownValue
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{detail.levelConstantHint}</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {/* This slot used to repeat the hero's asset badges verbatim. The
              measured numbers are what the hero cannot show. */}
          {peakDifficulty || durationText || downloadBytes.baseBytes > 0 ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>{detail.statsTitle}</CardTitle>
                <CardDescription>{detail.statsDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {peakDifficulty?.notes ? (
                    <StatRow label={detail.statsNotesLabel}>
                      <span className="tabular-nums">{peakDifficulty.notes.total}</span>
                      <span className="text-muted-foreground">
                        {difficultySlotLabel(peakDifficulty)}
                      </span>
                    </StatRow>
                  ) : null}
                  {durationText ? (
                    <StatRow label={detail.durationLabel}>
                      <span className="tabular-nums">{durationText}</span>
                    </StatRow>
                  ) : null}
                  {downloadBytes.baseBytes > 0 ? (
                    <StatRow label={detail.statsDownloadLabel}>
                      <span className="tabular-nums">
                        {downloadBytes.videoBytes > 0
                          ? detail.sizeEstimateWithVideo(
                              formatBytes(
                                downloadBytes.baseBytes + downloadBytes.videoBytes
                              ),
                              formatBytes(downloadBytes.videoBytes)
                            )
                          : detail.sizeEstimate(formatBytes(downloadBytes.baseBytes))}
                      </span>
                    </StatRow>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          <Card size="sm">
            <CardHeader>
              <CardTitle>{detail.source}</CardTitle>
              <CardDescription>{detail.sourceDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
              {/* The full URL was three lines of break-all text nobody could
                  read; the hostname is the part that answers "where is this
                  from", and the link answers the rest. */}
              {entry.source_url ? (
                <a
                  href={entry.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-current"
                >
                  {sourceHost ?? entry.source_url}
                  <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
              <p className="break-all">
                <span className="mr-1.5 text-foreground/80">{detail.sourceMaidataLabel}</span>
                {/* maidata.txt is mirrored into the site and served same-origin
                    (the R2 host only carries the media blobs, not maidata), so
                    surface the same-origin path here rather than the origin URL
                    stored in files.maidata. */}
                {entry.files.maidata
                  ? localChartAssetUrl(entry, "maidata.txt")
                  : entry.files.maidata_dx || entry.remote_dir_name}
              </p>
              {entry.license_note ? (
                <details className="group">
                  <summary className="w-fit cursor-pointer text-foreground/80 transition-colors hover:text-foreground">
                    {detail.licenseLabel}
                  </summary>
                  <p className="mt-1.5 break-words text-xs leading-relaxed">
                    {entry.license_note}
                  </p>
                </details>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </Reveal>

      {related.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">{detail.relatedTitle}</h2>
            <p className="text-sm text-muted-foreground">{detail.relatedDescription}</p>
          </div>
          {/* Real <a href> cross-links to sibling chart pages — the internal link
              graph the client-side browse grid (24 cards, button paging) can't give. */}
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {related.map((item, index) => {
              // Mirrors readRelatedEntries' pick priority, so the chip names
              // the strongest tie this sibling has to the current chart.
              const reason =
                entry.artist && item.artist === entry.artist
                  ? detail.relatedReasonArtist
                  : entry.genreid != null && item.genreid === entry.genreid
                    ? detail.relatedReasonGenre
                    : detail.relatedReasonVersion;
              return (
                <RelatedChartRow key={item.id} index={index}>
                  <Link
                    href={buildLocalePath(`/charts/${entrySlug(item)}`, locale)}
                    className="group flex h-full items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-2.5 transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/10"
                  >
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border/60 sm:size-18">
                      <EntryCover
                        entry={toRelatedCoverEntry(item)}
                        locale={locale}
                        sizes="72px"
                        className="h-full w-full rounded-lg"
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-1 text-sm font-semibold leading-snug">
                        {formatEntryTitle(item, locale)}
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {formatEntryArtist(item, locale)}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-tight text-primary">
                          {reason}
                        </span>
                        {item.difficulties.slice(-2).map((difficulty) => (
                          <DifficultyPill
                            key={`${item.id}-${difficulty.slot}`}
                            difficulty={difficulty}
                            showLabel
                            className="px-1.5 py-px text-[11px]"
                          />
                        ))}
                      </span>
                    </div>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[transform,opacity] duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                    />
                  </Link>
                </RelatedChartRow>
              );
            })}
          </ul>
        </section>
      ) : null}
      </article>
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
      <Reveal ssrVisible className="flex flex-col gap-2">
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

/** Hostname of an absolute URL, or null when the value is not one. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * A difficulty's note total with its bucket breakdown underneath.
 *
 * The breakdown is text rather than a nested table so it can wrap inside the
 * cell on a phone; the buckets are disjoint, so the parts really do sum to the
 * total shown above them.
 */
function NoteCountCell({
  counts,
  detail,
}: {
  counts: CatalogNoteCounts | undefined;
  detail: ReturnType<typeof getDictionary>["detail"];
}) {
  if (!counts || counts.total <= 0) {
    return <span className="text-muted-foreground">{detail.unknownValue}</span>;
  }
  const parts: [string, number][] = [
    [detail.noteTypeTap, counts.tap],
    [detail.noteTypeHold, counts.hold],
    [detail.noteTypeSlide, counts.slide],
    [detail.noteTypeTouch, counts.touch],
    [detail.noteTypeTouchHold, counts.touch_hold],
    [detail.noteTypeBreak, counts.break],
  ];
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="font-medium tabular-nums">{counts.total}</span>
      {/* The cap is what makes the breakdown wrap instead of stretching the
          table past a 390px viewport — a table cell is max-content otherwise. */}
      <span className="flex max-w-[8.5rem] flex-wrap justify-end gap-x-1.5 text-[11px] leading-tight text-muted-foreground">
        {parts
          .filter(([, value]) => value > 0)
          .map(([label, value]) => (
            <span key={label} className="whitespace-nowrap tabular-nums">
              {label} {value}
            </span>
          ))}
      </span>
    </span>
  );
}

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1.5 text-right font-medium">{children}</dd>
    </div>
  );
}

function MetadataItem({
  label,
  value,
  href,
  children,
}: {
  label: string;
  value?: string;
  href?: string;
  /** Badge or logo shown instead of `value`; skips the plain-text underline. */
  children?: React.ReactNode;
}) {
  const content = children ?? value;
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {/* A div, not a p: the badge variants render pictures and spans. */}
      <div className="mt-2 flex min-h-9 items-center text-base font-medium">
        {href ? (
          <Link
            href={href}
            className={
              children
                ? "inline-flex max-w-full items-center rounded-lg transition-opacity hover:opacity-80"
                : "underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-current"
            }
          >
            {content}
          </Link>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
