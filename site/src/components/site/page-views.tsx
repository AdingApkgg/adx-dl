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
import { EntryAssetBadges } from "@/components/site/entry-asset-badges";
import { EntryCover } from "@/components/site/entry-cover";
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
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary } from "@/lib/i18n";
import { toRouteSlug } from "@/lib/route-slug";

type SharedViewProps = {
  locale?: "zh" | "en" | "ja";
};

type HomePageViewProps = SharedViewProps & {
  catalog: Catalog;
};

type CatalogPageViewProps = SharedViewProps & {
  entries: CatalogEntry[];
  title: string;
  description: string;
};

type ChartDetailPageViewProps = SharedViewProps & {
  entry: CatalogEntry;
};

export function HomePageView({ catalog, locale = "zh" }: HomePageViewProps) {
  const dictionary = getDictionary(locale);
  const latestEntries = [...catalog.entries]
    .sort((a, b) => (b.imported_at ?? "").localeCompare(a.imported_at ?? ""))
    .slice(0, 8);
  const categoryBranches = Object.entries(catalog.categories).flatMap(([category, subcategories]) =>
    subcategories.map((subcategory) => `${category} · ${subcategory}`)
  );
  const searchHref = buildLocalePath("/search", locale);
  const chartsHref = buildLocalePath("/charts", locale);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 md:px-6 md:py-10">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <Card className="border border-border/70 bg-card/85">
          <CardHeader className="gap-3">
            <Badge variant="secondary" className="w-fit">
              {dictionary.home.badge}
            </Badge>
            <CardTitle className="text-4xl md:text-5xl">
              {dictionary.home.title}
            </CardTitle>
            <CardDescription className="max-w-3xl text-base">
              {dictionary.home.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Button size="lg" asChild>
                <Link href={searchHref}>
                  <SearchIcon data-icon="inline-start" />
                  {dictionary.home.searchCta}
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={chartsHref}>
                  <DownloadIcon data-icon="inline-start" />
                  {dictionary.home.browseCta}
                </Link>
              </Button>
            </div>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Total entries" value={`${catalog.total_entries}`} />
              <MetricCard
                label="Catalog categories"
                value={`${Object.keys(catalog.categories).length}`}
              />
              <MetricCard
                label="Catalog updated"
                value={new Date(catalog.generated_at).toLocaleString()}
                compact
              />
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="border border-border/70 bg-card/85">
          <CardHeader>
            <CardTitle>Catalog branches</CardTitle>
            <CardDescription>
              Quickly scan the category and branch groups exposed by the catalog.
            </CardDescription>
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
              <h2 className="text-2xl font-semibold">Latest Covers</h2>
              <p className="text-sm text-muted-foreground">
                Recently indexed remote charts with ready-to-browse cover art.
              </p>
            </div>
          </div>
        </div>
        {latestEntries.map((entry) => (
          <Card
            key={entry.id}
            size="sm"
            className="overflow-hidden border border-border/70 bg-card/85"
          >
            <div className="aspect-square overflow-hidden">
              <EntryCover entry={entry} locale={locale} className="h-full w-full" />
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
                  href={buildLocalePath(
                    `/charts/${toRouteSlug(entry.id)}`,
                    locale
                  )}
                >
                  <ArrowRightIcon data-icon="inline-start" />
                  Open Detail
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Data pipeline</CardTitle>
            <CardDescription>
              Remote directory scanning, `maidata` parsing, and static catalog
              generation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">
              <BoxesIcon data-icon="inline-start" />
              Remote index builder
            </Badge>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Static output</CardTitle>
            <CardDescription>
              Next.js 16 static export for Cloudflare Pages friendly deployment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Bun + Turbopack</Badge>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Downloads</CardTitle>
            <CardDescription>
              Builds download actions from the remote directory contents detected
              at catalog build time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Remote directory-driven</Badge>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

export function ChartsPageView({
  entries,
  locale = "zh",
}: SharedViewProps & { entries: CatalogEntry[] }) {
  const dictionary = getDictionary(locale);

  return (
    <CatalogPageView
      entries={entries}
      locale={locale}
      title={dictionary.charts.title}
      description={dictionary.charts.description}
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
    />
  );
}

export function ChartDetailPageView({
  entry,
  locale = "zh",
}: ChartDetailPageViewProps) {
  const dictionary = getDictionary(locale);
  const branchLabel = formatEntrySubcategory(entry);
  const showVersionBadge = entry.category !== "Remote" && entry.version;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80">
          <div className="aspect-square">
            <EntryCover entry={entry} locale={locale} className="h-full w-full" />
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
          <div className="flex flex-wrap gap-2">
            <EntryAssetBadges entry={entry} />
          </div>
          <div className="flex flex-wrap gap-2">
            {entry.download_mode === "onsite" || entry.download_mode === "mixed" ? (
              <AdxDownloadButton directoryName={entry.remote_dir_name} locale={locale} />
            ) : (
              <Button disabled>
                <DownloadIcon data-icon="inline-start" />
                {dictionary.detail.onsitePending}
              </Button>
            )}
            {(entry.download_mode === "external" || entry.download_mode === "mixed") &&
            entry.source_url ? (
              <Button variant="outline" asChild>
                <a href={entry.source_url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" />
                  {dictionary.detail.sourceLink}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{dictionary.detail.metadata}</CardTitle>
            <CardDescription>
              Parsed directly from the remote AstroDX directory resources.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <MetadataItem label="Version" value={entry.version || "Unknown"} />
              <MetadataItem label="Genre" value={entry.genre || "Unknown"} />
              <MetadataItem label="BPM" value={entry.bpm ? `${entry.bpm}` : "Unknown"} />
              <MetadataItem
                label="Short ID"
                value={entry.short_id || "Not available"}
              />
            </div>
            <Separator />
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{dictionary.detail.difficulties}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {entry.difficulties.map((difficulty) => (
                  <Card key={`${entry.id}-${difficulty.slot}`} size="sm">
                    <CardHeader>
                      <CardTitle className="text-base">
                        Level {difficulty.level || difficulty.slot}
                      </CardTitle>
                      <CardDescription>
                        Charter: {difficulty.designer || "Unknown"}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{dictionary.detail.assets}</CardTitle>
              <CardDescription>
                Resource availability detected from the remote directory.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <EntryAssetBadges entry={entry} />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>{dictionary.detail.source}</CardTitle>
              <CardDescription>
                Built from the remote AstroDX directory index.
              </CardDescription>
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
}: CatalogPageViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
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
