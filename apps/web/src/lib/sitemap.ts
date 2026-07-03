import type { MetadataRoute } from "next";

import { readCatalog, readVersionRouteIds } from "@/lib/catalog";
import { buildLocalePath, locales, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

export const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");

// Google's hard cap is 50,000 URLs / 50MB per sitemap. We cap well below that so
// each shard stays small and fast to fetch/parse; the ~4.8k-URL catalog splits
// into a few files that grow (and add shards) automatically as it does.
export const MAX_URLS_PER_SITEMAP = 2000;

const staticPaths = ["/", "/charts", "/status", "/versions", "/comments", "/links"] as const;

function toAbsoluteUrl(pathname: string): string {
  return pathname === "/" ? `${siteUrl}/` : `${siteUrl}${pathname}`;
}

function toAbsoluteAsset(url: string): string {
  return /^https?:\/\//.test(url)
    ? url
    : `${siteUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

// imported_at is clean ISO-8601 in the current catalog; the legacy "… N hours ago"
// suffix strip is kept as a guard. Trim sub-second precision (noise for <lastmod>).
export function toIsoDate(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.replace(/\s+\d+\s+\w+\s+ago$/i, "").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildLanguageAlternates(
  pathname: string
): NonNullable<MetadataRoute.Sitemap[number]["alternates"]> {
  return {
    languages: {
      "x-default": toAbsoluteUrl(buildLocalePath(pathname, "zh")),
      "zh-CN": toAbsoluteUrl(buildLocalePath(pathname, "zh")),
      en: toAbsoluteUrl(buildLocalePath(pathname, "en")),
      ja: toAbsoluteUrl(buildLocalePath(pathname, "ja")),
    },
  };
}

function buildSitemapEntry(
  pathname: string,
  locale: Locale,
  options?: { lastModified?: string; images?: string[] }
) {
  return {
    url: toAbsoluteUrl(buildLocalePath(pathname, locale)),
    alternates: buildLanguageAlternates(pathname),
    ...(options?.lastModified ? { lastModified: options.lastModified } : {}),
    ...(options?.images && options.images.length ? { images: options.images } : {}),
  } satisfies MetadataRoute.Sitemap[number];
}

// The full, unsharded URL list — static pages, then version pages, then every
// chart detail page (×3 locales, each with hreflang alternates + cover image).
export async function buildAllSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const catalog = await readCatalog();
  const siteLastModified = toIsoDate(catalog.generated_at);

  const staticRoutes = staticPaths.flatMap((pathname) =>
    locales.map((locale) =>
      buildSitemapEntry(pathname, locale, { lastModified: siteLastModified })
    )
  );

  const versionRouteIds = await readVersionRouteIds();
  const versionRoutes = versionRouteIds.flatMap((id) =>
    locales.map((locale) =>
      buildSitemapEntry(`/versions/${id}`, locale, { lastModified: siteLastModified })
    )
  );

  const detailRoutes = catalog.entries.flatMap((entry) => {
    const pathname = `/charts/${encodeURIComponent(entrySlug(entry))}`;
    const lastModified = toIsoDate(entry.imported_at) ?? siteLastModified;
    const images = entry.media.cover_url ? [toAbsoluteAsset(entry.media.cover_url)] : undefined;

    return locales.map((locale) =>
      buildSitemapEntry(pathname, locale, { lastModified, images })
    );
  });

  return [...staticRoutes, ...versionRoutes, ...detailRoutes];
}

// How many shards the current catalog needs (at least 1).
export async function getSitemapShardCount(): Promise<number> {
  const all = await buildAllSitemapEntries();
  return Math.max(1, Math.ceil(all.length / MAX_URLS_PER_SITEMAP));
}

// The slice of URLs for one shard id (0-based).
export async function getSitemapShard(id: number): Promise<MetadataRoute.Sitemap> {
  const all = await buildAllSitemapEntries();
  const start = id * MAX_URLS_PER_SITEMAP;
  return all.slice(start, start + MAX_URLS_PER_SITEMAP);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Serialize a shard to a <urlset> with hreflang alternates + cover images. We
// hand-roll the XML (rather than the sitemap.ts metadata convention) because the
// convention can't coexist with a custom /sitemap.xml index route.
export function serializeUrlset(entries: MetadataRoute.Sitemap): string {
  const urls = entries
    .map((entry) => {
      const lines = [`    <loc>${xmlEscape(entry.url)}</loc>`];
      const languages = entry.alternates?.languages;
      if (languages) {
        for (const [hreflang, href] of Object.entries(languages)) {
          if (href) {
            lines.push(
              `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${xmlEscape(String(href))}"/>`
            );
          }
        }
      }
      if (entry.lastModified) {
        const lastmod =
          entry.lastModified instanceof Date
            ? entry.lastModified.toISOString()
            : String(entry.lastModified);
        lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
      }
      for (const image of entry.images ?? []) {
        lines.push(
          `    <image:image><image:loc>${xmlEscape(String(image))}</image:loc></image:image>`
        );
      }
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>
`;
}
