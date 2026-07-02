import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Reveal } from "@/components/motion";
import { CatalogBrowser } from "@/components/site/catalog-browser";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { VersionsBatchGrid } from "@/components/site/versions-batch-grid";
import {
  toCatalogCardEntry,
  type CatalogEntry,
  type ChartDownloadSpec,
  type VersionGroup,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import {
  buildVersionDetailStructuredData,
  buildVersionsIndexStructuredData,
} from "@/lib/structured-data";
import { VERSION_IMAGE_DIMENSIONS, versionImageSrcByIndex } from "@/lib/version-image";

type VersionsIndexViewProps = {
  groups: VersionGroup[];
  /** Per-version chart download specs, keyed by version slug; enables batch download. */
  versionCharts?: Record<string, ChartDownloadSpec[]>;
  locale?: Locale;
};

type VersionDetailViewProps = {
  name: string;
  slug: string;
  imageIndex: number | null;
  entries: CatalogEntry[];
  locale?: Locale;
};

export function VersionsIndexView({
  groups,
  versionCharts = {},
  locale = "zh",
}: VersionsIndexViewProps) {
  const versions = getDictionary(locale).versions;
  const withCharts = groups.filter((group) => group.count > 0).length;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildVersionsIndexStructuredData(locale, groups)} />
      <Reveal ssrVisible className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{versions.title}</h1>
        <p className="text-muted-foreground">{versions.description}</p>
        <p className="text-sm text-muted-foreground">{versions.intro(withCharts)}</p>
      </Reveal>
      <VersionsBatchGrid groups={groups} versionCharts={versionCharts} locale={locale} />
    </main>
  );
}

export function VersionDetailView({
  name,
  slug,
  imageIndex,
  entries,
  locale = "zh",
}: VersionDetailViewProps) {
  const versions = getDictionary(locale).versions;
  const label = name === "Unknown" ? versions.unknownLabel : name;
  const src = imageIndex !== null ? versionImageSrcByIndex(imageIndex) : null;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildVersionDetailStructuredData(locale, name, slug, entries)} />
      <Reveal ssrVisible className="flex flex-col gap-3">
        <Link
          href={buildLocalePath("/versions", locale)}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {versions.backToIndex}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {src ? (
            <Image
              src={src}
              alt={label}
              width={VERSION_IMAGE_DIMENSIONS.width}
              height={VERSION_IMAGE_DIMENSIONS.height}
              unoptimized
              className="h-9 w-auto rounded-md"
            />
          ) : null}
          <h1 className="text-3xl font-semibold">{versions.detailTitle(label)}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {versions.detailIntro(label, entries.length)}
        </p>
      </Reveal>
      {/* Card-level slice only — the full entries stay server-side for the
          JSON-LD above; batch download fetches /charts/specs.json lazily. */}
      <CatalogBrowser
        entries={entries.map(toCatalogCardEntry)}
        locale={locale}
        detailPathPrefix={buildLocalePath("/charts", locale)}
        collectionName={label}
      />
    </main>
  );
}
