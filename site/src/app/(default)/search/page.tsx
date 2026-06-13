import { SearchPageView } from "@/components/site/page-views";
import { readCatalogEntries } from "@/lib/catalog";
import { buildSearchPageMetadata } from "@/lib/page-metadata";

export const metadata = buildSearchPageMetadata("zh");

export default async function SearchPage() {
  const entries = await readCatalogEntries();
  return <SearchPageView entries={entries} locale="zh" />;
}
