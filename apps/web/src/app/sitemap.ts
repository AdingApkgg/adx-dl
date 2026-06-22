import type { MetadataRoute } from "next";

import { readCatalog, readVersionSlugs } from "@/lib/catalog";
import { buildLocalePath, locales, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

export const dynamic = "force-static";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");
const staticPaths = ["/", "/charts", "/status", "/versions", "/comments", "/links"] as const;

function toAbsoluteUrl(pathname: string): string {
  if (pathname === "/") {
    return `${siteUrl}/`;
  }

  return `${siteUrl}${pathname}`;
}

function toAbsoluteAsset(url: string): string {
  if (/^https?:\/\//.test(url)) {
    return url;
  }
  return `${siteUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

// The catalog stores imported_at like "2026-06-13 05:25:43 +08:00 2 hours ago" —
// a non-ISO string with a trailing relative-time suffix. Strip it and normalize to
// ISO-8601 so crawlers accept <lastmod>; fall back to undefined when unparseable.
function toIsoDate(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.replace(/\s+\d+\s+\w+\s+ago$/i, "").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function buildLanguageAlternates(pathname: string): NonNullable<
  MetadataRoute.Sitemap[number]["alternates"]
> {
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await readCatalog();
  const siteLastModified = toIsoDate(catalog.generated_at);

  const staticRoutes = staticPaths.flatMap((pathname) =>
    locales.map((locale) =>
      buildSitemapEntry(pathname, locale, { lastModified: siteLastModified })
    )
  );

  const versionSlugs = await readVersionSlugs();
  const versionRoutes = versionSlugs.flatMap((slug) =>
    locales.map((locale) =>
      buildSitemapEntry(`/versions/${slug}`, locale, { lastModified: siteLastModified })
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
