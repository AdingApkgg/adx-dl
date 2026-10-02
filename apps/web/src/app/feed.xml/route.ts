import { readCatalog } from "@/lib/catalog";
import {
  buildChartDescription,
  formatEntrySubcategory,
  formatEntryTitle,
  genreLabel,
  entryAddedAt,
  sortByAddedDesc,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

// Atom feed of the latest charts — a freshness surface for feed-watching AI
// crawlers (Perplexity/DuckAssistBot) and human subscribers. Static at build time.
export const dynamic = "force-static";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");
const FEED_SIZE = 50;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function chartEntryXml(entry: CatalogEntry): string {
  const url = `${siteUrl}/charts/${encodeURIComponent(entrySlug(entry))}`;
  const title = formatEntryTitle(entry, "en");
  // Atom semantics: <published> is when the chart was first added, <updated>
  // when its content last changed (e.g. a difficulty filled in later).
  const published = entryAddedAt(entry) ?? "";
  const updated = entry.imported_at ?? published;
  const categories = [formatEntrySubcategory(entry), entry.genre ? genreLabel(entry, "en") : ""]
    .filter(Boolean)
    .map((term) => `    <category term="${xmlEscape(term)}"/>`)
    .join("\n");

  return `  <entry>
    <title>${xmlEscape(title)}</title>
    <link href="${xmlEscape(url)}"/>
    <id>${xmlEscape(url)}</id>
    ${updated ? `<updated>${updated}</updated>\n    <published>${published || updated}</published>` : ""}
    <summary>${xmlEscape(buildChartDescription(entry, "en"))}</summary>
${categories}
  </entry>`;
}

export async function GET() {
  const catalog = await readCatalog();
  // Shared with the homepage's "latest charts" rail so both agree on what
  // "newest" means; sortByAddedDesc copies before sorting.
  const recent = sortByAddedDesc(catalog.entries).slice(0, FEED_SIZE);
  const updated =
    recent
      .map((entry) => entry.imported_at ?? entryAddedAt(entry) ?? "")
      .reduce((latest, stamp) => (stamp > latest ? stamp : latest), "") || catalog.generated_at;

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ADX 谱面资源 — latest charts</title>
  <subtitle>Newly added AstroDX charts (maimai DX-style rhythm-game charts).</subtitle>
  <link href="${siteUrl}/feed.xml" rel="self"/>
  <link href="${siteUrl}/"/>
  <id>${siteUrl}/</id>
  <updated>${updated}</updated>
  <author>
    <name>ADX 谱面资源</name>
    <uri>${siteUrl}/</uri>
  </author>
${recent.map(chartEntryXml).join("\n")}
</feed>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
    },
  });
}
