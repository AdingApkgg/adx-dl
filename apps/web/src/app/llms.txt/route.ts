import { readCatalog } from "@/lib/catalog";
import { resolveSiteUrl } from "@/lib/site-url";

// Static text file for LLM / answer-engine ingestion (the emerging /llms.txt
// convention). Rendered to a static file at build time under output: export.
export const dynamic = "force-static";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");

export async function GET() {
  const catalog = await readCatalog();
  const versions = [...new Set(Object.values(catalog.categories).flat())].sort();

  const body = `# AstroDX Archive

> AstroDX Archive is an unofficial, community-maintained index of AstroDX charts (maimai DX-style rhythm-game charts). It provides per-chart metadata, cover art, difficulty information, and download links, built from a remote AstroDX directory.

The archive currently lists ${catalog.total_entries} charts across ${versions.length} maimai DX version branches. Content is available in Chinese (default), English, and Japanese.

## Key pages
- Home: ${siteUrl}/
- Browse charts: ${siteUrl}/charts
- Search: ${siteUrl}/search
- Server status: ${siteUrl}/status
- Sitemap: ${siteUrl}/sitemap.xml

## Localized entry points
- 中文 (default): ${siteUrl}/
- English: ${siteUrl}/en
- 日本語: ${siteUrl}/ja

## About
- AstroDX is a community-built simulator for maimai-style rhythm-game charts. maimai DX is SEGA's arcade rhythm game; AstroDX charts recreate its play format.
- This site is an unofficial fan archive and is not affiliated with SEGA or the AstroDX developers. AstroDX and maimai are the property of their respective owners.
- Source code: https://github.com/AdingApkgg/adx-dl

## maimai DX version branches covered
${versions.map((version) => `- ${version}`).join("\n")}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
