import { UiShowcaseView } from "@/components/site/ui-showcase-view";
import { readCatalogEntries } from "@/lib/catalog";
import { buildUiPageMetadata } from "@/lib/page-metadata";

export const metadata = buildUiPageMetadata("zh");

// Mirrors [locale]/ui/page.tsx. The catalogue read lives here rather than in the
// view so the view stays synchronous — the route tests render it directly.
export default async function UiPage() {
  const entries = await readCatalogEntries();
  return <UiShowcaseView locale="zh" entries={entries} />;
}
