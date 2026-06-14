import Link from "next/link";
import {
  ArrowRightIcon,
  BoxesIcon,
  DownloadIcon,
  ExternalLinkIcon,
  SearchIcon,
} from "lucide-react";

import { AdxDownloadButton } from "@/components/site/adx-download-button";
import { CatalogBrowser } from "@/components/site/catalog-browser";
import { ChartMediaPlayer } from "@/components/site/chart-media-player";
import { EntryAssetBadges } from "@/components/site/entry-asset-badges";
import { EntryCover } from "@/components/site/entry-cover";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
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
  difficultySlotLabel,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
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
  pageKey: "charts" | "search";
};

type ChartDetailPageViewProps = SharedViewProps & {
  entry: CatalogEntry;
};

export function HomePageView({ catalog, locale = "zh" }: HomePageViewProps) {
  const dictionary = getDictionary(locale);
  const home = dictionary.home;
  const latestEntries = [...catalog.entries]
    .sort((a, b) => (b.imported_at ?? "").localeCompare(a.imported_at ?? ""))
    .slice(0, 8);
  const categoryBranches = Object.entries(catalog.categories).flatMap(([category, subcategories]) =>
    subcategories.map((subcategory) => `${category} · ${subcategory}`)
  );
  const versionCount = new Set(Object.values(catalog.categories).flat()).size;
  const updatedDate = catalog.generated_at.slice(0, 10);
  const faqItems = home.faq(catalog.total_entries, versionCount);
  const searchHref = buildLocalePath("/search", locale);
  const chartsHref = buildLocalePath("/charts", locale);

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
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <Card className="border border-border/70 bg-card/85">
          <CardHeader className="gap-3">
            <Badge variant="secondary" className="w-fit">
              {home.badge}
            </Badge>
            <CardTitle asChild className="text-4xl md:text-5xl">
              <h1>{home.title}</h1>
            </CardTitle>
            <CardDescription className="max-w-3xl text-base">
              {home.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Button size="lg" asChild>
                <Link href={searchHref}>
                  <SearchIcon data-icon="inline-start" aria-hidden="true" />
                  {home.searchCta}
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={chartsHref}>
                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  {home.browseCta}
                </Link>
              </Button>
            </div>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label={home.metricsTotal} value={`${catalog.total_entries}`} />
              <MetricCard
                label={home.metricsCategories}
                value={`${Object.keys(catalog.categories).length}`}
              />
              <MetricCard label={home.metricsUpdated} value={updatedDate} compact />
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="border border-border/70 bg-card/85">
          <CardHeader>
            <CardTitle>{home.branchesTitle}</CardTitle>
            <CardDescription>{home.branchesDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {categoryBranches.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2 xl:col-span-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold">{home.latestTitle}</h2>
              <p className="text-sm text-muted-foreground">{home.latestDescription}</p>
            </div>
          </div>
        </div>
        {latestEntries.map((entry, index) => (
          <Card
            key={entry.id}
            size="sm"
            className="overflow-hidden border border-border/70 bg-card/85"
          >
            <div className="aspect-square overflow-hidden">
              <EntryCover
                entry={entry}
                locale={locale}
                priority={index < 4}
                sizes="(max-width: 768px) 50vw, 25vw"
                className="h-full w-full"
              />
            </div>
            <CardHeader>
              <CardTitle>{formatEntryTitle(entry, locale)}</CardTitle>
              <CardDescription>{formatEntryArtist(entry, locale)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{formatEntrySubcategory(entry)}</Badge>
                {entry.difficulties.slice(0, 3).map((difficulty) => (
                  <Badge key={`${entry.id}-${difficulty.slot}`} variant="outline">
                    {difficulty.level || `Lv.${difficulty.slot}`}
                  </Badge>
                ))}
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={buildLocalePath(`/charts/${entrySlug(entry)}`, locale)}
                  aria-label={`${home.openDetail} — ${formatEntryTitle(entry, locale)}`}
                >
                  <ArrowRightIcon data-icon="inline-start" aria-hidden="true" />
                  {home.openDetail}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{home.pipelineTitle}</CardTitle>
            <CardDescription>{home.pipelineDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">
              <BoxesIcon data-icon="inline-start" aria-hidden="true" />
              {home.pipelineBadge}
            </Badge>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{home.staticTitle}</CardTitle>
            <CardDescription>{home.staticDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{home.staticBadge}</Badge>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{home.downloadsTitle}</CardTitle>
            <CardDescription>{home.downloadsDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{home.downloadsBadge}</Badge>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{home.faqHeading}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {faqItems.map((item) => (
            <Card key={item.q} size="sm" className="border border-border/70 bg-card/85">
              <CardHeader>
                <CardTitle asChild>
                  <h3 className="text-base font-medium">{item.q}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.a}</p>
              </CardContent>
            </Card>
          ))}
        </div>
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
      pageKey="charts"
    />
  );
}

export function SearchPageView({
  entries,
  locale = "zh",
}: SharedViewProps & { entries: CatalogEntry[] }) {
  const dictionary = getDictionary(locale);

  return (
    <CatalogPageView
      entries={entries}
      locale={locale}
      title={dictionary.searchPage.title}
      description={dictionary.searchPage.description}
      intro={dictionary.searchPage.intro(entries.length)}
      pageKey="search"
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
  const showVersionBadge = entry.category !== "Remote" && entry.version;
  const description = buildChartDescription(entry, locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildChartDetailStructuredData(locale, entry)} />
      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80">
          <div className="aspect-square">
            <EntryCover
              entry={entry}
              locale={locale}
              priority
              sizes="(max-width: 1024px) 100vw, 320px"
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/80 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{entry.category}</Badge>
            <Badge variant="outline">{branchLabel}</Badge>
            {showVersionBadge ? <Badge variant="outline">{entry.version}</Badge> : null}
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold">{formatEntryTitle(entry, locale)}</h1>
            <p className="text-lg text-muted-foreground">{formatEntryArtist(entry, locale)}</p>
          </div>
          <p className="text-base leading-relaxed text-muted-foreground">{description}</p>
          <div className="flex flex-wrap gap-2">
            <EntryAssetBadges entry={entry} locale={locale} />
          </div>
          <div className="flex flex-wrap gap-2">
            {entry.download_mode === "onsite" || entry.download_mode === "mixed" ? (
              <AdxDownloadButton directoryName={entry.remote_dir_name} locale={locale} />
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
      </section>

      <ChartMediaPlayer entry={entry} locale={locale} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{detail.metadata}</CardTitle>
            <CardDescription>{detail.metadataDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <MetadataItem label={detail.versionLabel} value={entry.version || detail.unknownValue} />
              <MetadataItem label={detail.genreLabel} value={entry.genre || detail.unknownValue} />
              <MetadataItem
                label={detail.bpmLabel}
                value={entry.bpm ? `${entry.bpm}` : detail.unknownValue}
              />
              <MetadataItem
                label={detail.shortIdLabel}
                value={entry.short_id || detail.notAvailableValue}
              />
            </div>
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
                          {difficultySlotLabel(difficulty.slot)}
                        </th>
                        <td className="py-2 pr-4">{difficulty.level || "-"}</td>
                        <td className="py-2">{difficulty.designer || detail.unknownValue}</td>
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
            <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>{entry.source_url}</p>
              <p>{entry.files.maidata || entry.files.maidata_dx || entry.remote_dir_name}</p>
              <p>{entry.license_note}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function CatalogPageView({
  entries,
  locale = "zh",
  title,
  description,
  intro,
  pageKey,
}: CatalogPageViewProps) {
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildListingStructuredData(locale, entries, pageKey)} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      <CatalogBrowser
        entries={entries}
        locale={locale}
        detailPathPrefix={buildLocalePath("/charts", locale)}
      />
    </main>
  );
}

function MetricCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={compact ? "mt-2 text-sm font-medium" : "mt-2 text-3xl font-semibold"}>
        {value}
      </p>
    </div>
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
