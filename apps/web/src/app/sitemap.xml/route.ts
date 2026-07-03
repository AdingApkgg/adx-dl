import { readCatalog } from "@/lib/catalog";
import { getSitemapShardCount, siteUrl, toIsoDate } from "@/lib/sitemap";

// The sitemap INDEX at /sitemap.xml — the stable entry point robots.txt declares.
// Its children are the sharded urlsets Next emits from app/sitemap.ts at
// /sitemap/[id].xml. Static at build time under output: export.
export const dynamic = "force-static";

export async function GET() {
  const [count, catalog] = await Promise.all([getSitemapShardCount(), readCatalog()]);
  const lastmod = toIsoDate(catalog.generated_at);

  const sitemaps = Array.from({ length: count }, (_, id) =>
    [
      "  <sitemap>",
      `    <loc>${siteUrl}/sitemap/${id}.xml</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      "  </sitemap>",
    ].join("\n")
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
