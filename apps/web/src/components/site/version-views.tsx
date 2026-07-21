import { Reveal } from "@/components/motion";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { VersionScrollSpine } from "@/components/site/version-scroll-spine";
import { VersionsBatchGrid } from "@/components/site/versions-batch-grid";
import {
  type ChartDownloadSpec,
  type VersionGroup,
} from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildVersionsIndexStructuredData } from "@/lib/structured-data";

type VersionsIndexViewProps = {
  groups: VersionGroup[];
  /** Per-version chart download specs, keyed by version slug; enables batch download. */
  versionCharts?: Record<string, ChartDownloadSpec[]>;
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
      {/* Scroll-progress spine decorating the grid's left gutter (md+ only). */}
      <VersionScrollSpine>
        <VersionsBatchGrid groups={groups} versionCharts={versionCharts} locale={locale} />
      </VersionScrollSpine>
    </main>
  );
}
