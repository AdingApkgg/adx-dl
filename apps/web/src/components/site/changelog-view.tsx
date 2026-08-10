import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Reveal } from "@/components/motion";
import { ChartCard } from "@/components/site/chart-card";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { buildVersionFilterHref } from "@/lib/catalog-links";
import {
  isRecentImport,
  toCatalogCardEntry,
  type Catalog,
} from "@/lib/catalog-shared";
import { buildChangelogBatches } from "@/lib/changelog";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

type ChangelogViewProps = {
  catalog: Catalog;
  locale?: Locale;
};

export function ChangelogView({ catalog, locale = "zh" }: ChangelogViewProps) {
  const { changelog, seo, versions } = getDictionary(locale);
  const batches = buildChangelogBatches(catalog.entries);
  const chartsHref = buildLocalePath("/charts", locale);
  const versionsHref = buildLocalePath("/versions", locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/changelog",
          title: changelog.title,
          description: seo.changelog,
        })}
      />
      <Reveal ssrVisible className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{changelog.title}</h1>
        <p className="text-muted-foreground">{changelog.description}</p>
        <p className="text-sm text-muted-foreground">{changelog.intro}</p>
      </Reveal>

      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{changelog.empty}</p>
      ) : (
        batches.map((batch) => (
          <section key={batch.date} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border/60 pt-5">
              <h2 className="text-xl font-semibold">
                {changelog.batchHeading(batch.date)}
              </h2>
              <span className="text-sm tabular-nums text-muted-foreground">
                {changelog.batchCount(batch.total)}
              </span>
            </div>

            {/* A 1600-chart batch cannot render as cards in a statically
                exported page, so the preview is capped and the remainder is
                handed to the catalog, split by the versions it actually spans
                — a filter the visitor would otherwise have to guess at. */}
            {batch.versions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">{changelog.versionsLabel}</span>
                {batch.versions.map((version) => (
                  <Link
                    key={version.name}
                    href={buildVersionFilterHref(version.versionId, locale)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {changelog.versionLink(
                      version.name === "Unknown" ? versions.unknownLabel : version.name,
                      version.count
                    )}
                  </Link>
                ))}
                {/* The seed import touched all 27 versions; listing them all
                    would bury the batch under its own link list. */}
                {batch.hiddenVersionCount > 0 ? (
                  <Link
                    href={versionsHref}
                    className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {changelog.moreVersions(batch.hiddenVersionCount)}
                  </Link>
                ) : null}
              </div>
            ) : null}

            <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
              {batch.preview.map((entry) => (
                <li key={entry.id} className="h-full">
                  <ChartCard
                    entry={toCatalogCardEntry(entry)}
                    locale={locale}
                    coverFit="contain"
                    isNew={isRecentImport(entry.imported_at, catalog.generated_at)}
                    sizes="(max-width: 760px) 50vw, (max-width: 1100px) 33vw, 220px"
                  />
                </li>
              ))}
            </ul>

            {/* A single-version batch can hand the remainder straight to that
                version's filtered catalog; a mixed one has no single filter
                that covers it, so the version links above do that job. */}
            {batch.hiddenCount > 0 ? (
              <Link
                href={
                  batch.versions.length === 1
                    ? buildVersionFilterHref(batch.versions[0].versionId, locale)
                    : chartsHref
                }
                className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {changelog.viewRest(batch.hiddenCount)}
                <ArrowRightIcon aria-hidden="true" className="size-3.5" />
              </Link>
            ) : null}
          </section>
        ))
      )}
    </main>
  );
}
