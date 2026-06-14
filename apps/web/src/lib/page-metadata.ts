import type { Metadata } from "next";

import {
  buildChartDescription,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import {
  buildLocalePath,
  getStaticPageMetadata,
  locales,
  type Locale,
  type StaticPageMetadataKey,
} from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const openGraphImageUrl = `${siteUrl}/opengraph-image.png`;
const siteName = "AstroDX Archive";
const robots = {
  index: true,
  follow: true,
} as const;

const ogLocaleMap: Record<Locale, string> = {
  zh: "zh_CN",
  en: "en_US",
  ja: "ja_JP",
};

type PageMetadataOptions = {
  locale: Locale;
  pathname: string;
  title: string;
  description: string;
  keywords: string[];
  image?: string;
  imageAlt?: string;
};

function buildLanguageAlternates(pathname: string) {
  return {
    "x-default": buildLocalePath(pathname, "zh"),
    "zh-CN": buildLocalePath(pathname, "zh"),
    en: buildLocalePath(pathname, "en"),
    ja: buildLocalePath(pathname, "ja"),
  };
}

function buildCanonicalUrl(pathname: string, locale: Locale) {
  const canonicalPath = buildLocalePath(pathname, locale);
  return `${siteUrl}${canonicalPath === "/" ? "" : canonicalPath}`;
}

function buildAlternateLocales(locale: Locale): string[] {
  return locales.filter((value) => value !== locale).map((value) => ogLocaleMap[value]);
}

function buildDetailKeywords(locale: Locale, entry: CatalogEntry) {
  return [
    "AstroDX",
    siteName,
    formatEntryTitle(entry, locale),
    formatEntryArtist(entry, locale),
    formatEntrySubcategory(entry),
  ];
}

export function buildPageMetadata({
  locale,
  pathname,
  title,
  description,
  keywords,
  image,
  imageAlt,
}: PageMetadataOptions): Metadata {
  const canonicalPath = buildLocalePath(pathname, locale);
  const canonicalUrl = buildCanonicalUrl(pathname, locale);
  const fullTitle = `${title} | ${siteName}`;
  const ogImage = { url: image ?? openGraphImageUrl, alt: imageAlt ?? fullTitle };

  return {
    metadataBase: new URL(siteUrl),
    title: fullTitle,
    description,
    keywords,
    robots,
    alternates: {
      canonical: canonicalPath,
      languages: buildLanguageAlternates(pathname),
    },
    openGraph: {
      type: "website",
      title: fullTitle,
      description,
      url: canonicalUrl,
      siteName,
      locale: ogLocaleMap[locale],
      alternateLocale: buildAlternateLocales(locale),
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
  };
}

export function buildLocalizedPageMetadata(
  locale: Locale,
  page: StaticPageMetadataKey
): Metadata {
  const pageMetadata = getStaticPageMetadata(locale)[page];

  return buildPageMetadata({
    locale,
    pathname: pageMetadata.pathname,
    title: pageMetadata.title,
    description: pageMetadata.description,
    keywords: pageMetadata.keywords,
  });
}

export function buildHomePageMetadata(locale: Locale): Metadata {
  return buildLocalizedPageMetadata(locale, "home");
}

export function buildChartsPageMetadata(locale: Locale): Metadata {
  return buildLocalizedPageMetadata(locale, "charts");
}

export function buildSearchPageMetadata(locale: Locale): Metadata {
  return buildLocalizedPageMetadata(locale, "search");
}

export function buildStatusPageMetadata(locale: Locale): Metadata {
  return buildLocalizedPageMetadata(locale, "status");
}

export function buildChartDetailMetadata(locale: Locale, entry: CatalogEntry): Metadata {
  return buildPageMetadata({
    locale,
    pathname: `/charts/${entrySlug(entry)}`,
    title: formatEntryTitle(entry, locale),
    description: buildChartDescription(entry, locale),
    keywords: buildDetailKeywords(locale, entry),
    image: entry.media.cover_url || openGraphImageUrl,
    imageAlt: formatEntryTitle(entry, locale),
  });
}
