import { readCatalog } from "@/lib/catalog";
import { uniqueChartDesigners } from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { resolveSiteUrl } from "@/lib/site-url";

// Static text file for LLM / answer-engine ingestion (the emerging /llms.txt
// convention). Rendered to a static file at build time under output: export.
export const dynamic = "force-static";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");

export async function GET() {
  const catalog = await readCatalog();
  const versions = [...new Set(Object.values(catalog.categories).flat())].sort();
  const designerCount = new Set(
    catalog.entries.flatMap((entry) => uniqueChartDesigners(entry))
  ).size;
  // The knowledge card is English-only for consistent AI ingestion; the FAQ text
  // is reused verbatim from the on-page home FAQ (English dictionary).
  const faq = getDictionary("en").home.faq(catalog.total_entries, versions.length);

  const body = `# ADX 谱面资源

> ADX 谱面资源 is an unofficial, community-maintained index of AstroDX charts (maimai DX-style rhythm-game charts). It provides per-chart metadata, cover art, difficulty information, alias (别名) search, and download links, built from a remote AstroDX directory.

The archive currently lists ${catalog.total_entries} charts across ${versions.length} maimai DX version branches, contributed by ${designerCount} credited chart designers. Content is available in Chinese (default), English, and Japanese. Charts are searchable by title, artist, and community nickname (别名).

## Key pages
- Home: ${siteUrl}/
- Browse charts: ${siteUrl}/charts
- Browse by version: ${siteUrl}/versions
- Server status: ${siteUrl}/status
- Full chart manifest (for machines): ${siteUrl}/llms-full.txt
- Atom feed (latest charts): ${siteUrl}/feed.xml
- License, sources and usage notes: ${siteUrl}/license
- Sitemap: ${siteUrl}/sitemap.xml

## Localized entry points
- 中文 (default): ${siteUrl}/
- English: ${siteUrl}/en
- 日本語: ${siteUrl}/ja

## Community pages
- Comments / guestbook: ${siteUrl}/comments
- Friend links & resources: ${siteUrl}/links
- Telegram community: https://t.me/FullDiveSAO

## Frequently asked
${faq.map(({ q, a }) => `### ${q}\n${a}`).join("\n\n")}

## About
- AstroDX is a community-built simulator for maimai-style rhythm-game charts. maimai DX is SEGA's arcade rhythm game; AstroDX charts recreate its play format.
- This site is an unofficial fan archive and is not affiliated with SEGA or the AstroDX developers. AstroDX and maimai are the property of their respective owners.
- Maintainer: https://github.com/AdingApkgg · Source code: https://github.com/AdingApkgg/adx-dl

## maimai DX version branches covered
${versions.map((version) => `- ${version}`).join("\n")}

## Last updated
${catalog.generated_at}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
