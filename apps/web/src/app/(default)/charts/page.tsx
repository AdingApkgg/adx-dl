import { Reveal } from "@/components/motion";
import { CatalogBrowser } from "@/components/site/catalog-browser";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { readCatalogEntries } from "@/lib/catalog";
import { formatEntrySubcategory, toCatalogCardEntry } from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary } from "@/lib/i18n";
import { buildChartsPageMetadata } from "@/lib/page-metadata";
import { buildListingStructuredData } from "@/lib/structured-data";

export const metadata = buildChartsPageMetadata("zh");

// Mirrors [locale]/charts/page.tsx. The layout is rendered here (not via
// ChartsPageView) so only the card-level slice of each entry crosses into the
// client CatalogBrowser — embedding the full entries (file specs, media URLs,
// license text) made the page payload several MB. Batch download specs load
// lazily from /charts/specs.json when select mode is entered.
export default async function ChartsPage() {
  const locale = "zh";
  const dictionary = getDictionary(locale);
  const entries = await readCatalogEntries();
  const versionCount = new Set(entries.map((entry) => formatEntrySubcategory(entry))).size;
  const cardEntries = entries.map(toCatalogCardEntry);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildListingStructuredData(locale, entries)} />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{dictionary.charts.title}</h1>
        <p className="text-muted-foreground">{dictionary.charts.description}</p>
        <p className="text-sm text-muted-foreground">
          {dictionary.charts.intro(entries.length, versionCount)}
        </p>
      </Reveal>
      <CatalogBrowser
        entries={cardEntries}
        locale={locale}
        detailPathPrefix={buildLocalePath("/charts", locale)}
      />
    </main>
  );
}
