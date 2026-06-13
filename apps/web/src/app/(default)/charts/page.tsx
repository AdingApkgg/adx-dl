import { ChartsPageView } from "@/components/site/page-views";
import { readCatalogEntries } from "@/lib/catalog";
import { buildChartsPageMetadata } from "@/lib/page-metadata";

export const metadata = buildChartsPageMetadata("zh");

export default async function ChartsPage() {
  const entries = await readCatalogEntries();
  return <ChartsPageView entries={entries} locale="zh" />;
}
