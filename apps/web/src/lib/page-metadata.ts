import type { Metadata } from "next";

import {
  buildChartDescription,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  genreLabel,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import {
  buildLocalePath,
  getDictionary,
  getStaticPageMetadata,
  locales,
  type Locale,
  type StaticPageMetadataKey,
} from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const openGraphImageUrl = `${siteUrl}/opengraph-image.png`;
const siteName = "ADX 谱面资源";
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
    ...(entry.genre ? [genreLabel(entry, locale)] : []),
    "maimai",
  ].filter(Boolean);
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

export function buildStatusPageMetadata(locale: Locale): Metadata {
  return buildLocalizedPageMetadata(locale, "status");
}

export function buildGuestbookPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const guestbook = dictionary.guestbook;
  return buildPageMetadata({
    locale,
    pathname: "/comments",
    title: guestbook.title,
    description: dictionary.seo.guestbook,
    keywords: ["AstroDX", siteName, guestbook.title, "guestbook", "留言板", "comments"],
  });
}

export function buildLinksPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const links = dictionary.links;
  return buildPageMetadata({
    locale,
    pathname: "/links",
    title: links.title,
    description: dictionary.seo.links,
    keywords: ["AstroDX", siteName, links.title, "maimai", "友情链接", "friend links"],
  });
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

export function buildVersionsPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const versions = dictionary.versions;
  return buildPageMetadata({
    locale,
    pathname: "/versions",
    title: versions.title,
    description: dictionary.seo.versions,
    keywords: ["AstroDX", siteName, versions.title, "maimai DX"],
  });
}

export function buildVersionDetailMetadata(
  locale: Locale,
  name: string,
  slug: string,
  count: number
): Metadata {
  const dictionary = getDictionary(locale);
  const versions = dictionary.versions;
  const label = name === "Unknown" ? versions.unknownLabel : name;
  return buildPageMetadata({
    locale,
    pathname: `/versions/${slug}`,
    title: versions.detailTitle(label),
    description: dictionary.seo.versionDetail(label, count),
    keywords: ["AstroDX", siteName, label, "maimai DX"],
  });
}
