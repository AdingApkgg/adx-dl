import type { Metadata } from "next";

import {
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { toRouteSlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const openGraphImageUrl = `${siteUrl}/opengraph-image.png`;

type PageMetadataOptions = {
  locale: Locale;
  pathname: string;
  title: string;
  description: string;
};

function buildLanguageAlternates(pathname: string) {
  return {
    "zh-CN": buildLocalePath(pathname, "zh"),
    en: buildLocalePath(pathname, "en"),
    ja: buildLocalePath(pathname, "ja"),
  };
}

export function buildPageMetadata({
  locale,
  pathname,
  title,
  description,
}: PageMetadataOptions): Metadata {
  const canonicalPath = buildLocalePath(pathname, locale);

  return {
    metadataBase: new URL(siteUrl),
    title: `${title} | AstroDX Archive`,
    description,
    alternates: {
      canonical: canonicalPath,
      languages: buildLanguageAlternates(pathname),
    },
    openGraph: {
      images: [openGraphImageUrl],
    },
    twitter: {
      card: "summary_large_image",
      images: [openGraphImageUrl],
    },
  };
}

export function buildHomePageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);

  return buildPageMetadata({
    locale,
    pathname: "/",
    title: dictionary.home.title,
    description: dictionary.home.description,
  });
}

export function buildChartsPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);

  return buildPageMetadata({
    locale,
    pathname: "/charts",
    title: dictionary.charts.title,
    description: dictionary.charts.description,
  });
}

export function buildSearchPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);

  return buildPageMetadata({
    locale,
    pathname: "/search",
    title: dictionary.searchPage.title,
    description: dictionary.searchPage.description,
  });
}

export function buildStatusPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);

  return buildPageMetadata({
    locale,
    pathname: "/status",
    title: dictionary.statusPage.title,
    description: dictionary.statusPage.description,
  });
}

export function buildChartDetailMetadata(locale: Locale, entry: CatalogEntry): Metadata {
  return buildPageMetadata({
    locale,
    pathname: `/charts/${toRouteSlug(entry.id)}`,
    title: formatEntryTitle(entry, locale),
    description: `${formatEntryArtist(entry, locale)} \u00b7 ${entry.category} \u00b7 ${formatEntrySubcategory(entry)}`,
  });
}
