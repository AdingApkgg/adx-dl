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

type OpenGraphType = "website" | "music.song";

type PageMetadataOptions = {
  locale: Locale;
  pathname: string;
  title: string;
  description: string;
  keywords: string[];
  image?: string;
  imageAlt?: string;
  ogType?: OpenGraphType;
};

const staticSeoTitles: Record<Locale, Record<StaticPageMetadataKey, string>> = {
  zh: {
    home: "AstroDX 谱面资料站与下载入口",
    charts: "AstroDX 谱面浏览与下载目录",
    status: "ADX 谱面资源服务器状态监控",
  },
  en: {
    home: "AstroDX Chart Archive, Browser and Download Portal",
    charts: "AstroDX Chart Browser and Download Catalog",
    status: "ADX Server Status and Download Service Monitor",
  },
  ja: {
    home: "AstroDX 譜面アーカイブとダウンロード入口",
    charts: "AstroDX 譜面一覧とダウンロードカタログ",
    status: "ADX サーバー状態とダウンロード監視",
  },
};

const licensePageMetadata: Record<Locale, { title: string; description: string }> = {
  zh: {
    title: "ADX 谱面资源许可、来源与使用说明",
    description:
      "说明 ADX 谱面资源的目录索引来源、谱面与媒体资源权利归属、站点代码与数据的使用边界，以及 AstroDX 和 maimai 相关内容的非官方性质。",
  },
  en: {
    title: "ADX Chart Catalog License, Sources and Usage Notes",
    description:
      "Explains the ADX chart catalog sources, ownership of chart and media assets, usage boundaries for site data, and the archive's unofficial relationship to AstroDX and maimai.",
  },
  ja: {
    title: "ADX 譜面カタログのライセンス、出典、利用案内",
    description:
      "ADX 譜面カタログの出典、譜面とメディア素材の権利帰属、サイトデータの利用範囲、AstroDX と maimai に対する非公式の位置づけを説明します。",
  },
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

function staticSeoTitle(locale: Locale, page: StaticPageMetadataKey): string {
  return staticSeoTitles[locale][page];
}

function buildChartDetailSeoTitle(locale: Locale, entry: CatalogEntry): string {
  const title = formatEntryTitle(entry, locale);

  if (locale === "zh") {
    return `${title} AstroDX 谱面预览与下载`;
  }
  if (locale === "ja") {
    return `${title} AstroDX 譜面プレビューとダウンロード`;
  }
  return `${title} AstroDX Chart Preview and Download`;
}

function buildGuestbookSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "AstroDX 玩家留言板与反馈";
  }
  if (locale === "ja") {
    return "AstroDX プレイヤーのゲストブックとフィードバック";
  }
  return "AstroDX Player Guestbook and Feedback";
}

function buildLinksSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "maimai 与 AstroDX 友情链接资源";
  }
  if (locale === "ja") {
    return "maimai と AstroDX の関連リンク集";
  }
  return "maimai and AstroDX Community Links";
}

function buildVersionsSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "maimai DX 版本谱面浏览";
  }
  if (locale === "ja") {
    return "maimai DX バージョン別譜面一覧";
  }
  return "maimai DX Version Chart Browser";
}

function buildVersionDetailSeoTitle(locale: Locale, label: string): string {
  if (locale === "zh") {
    return `${label} AstroDX 谱面浏览与下载`;
  }
  if (locale === "ja") {
    return `${label} AstroDX 譜面一覧とダウンロード`;
  }
  return `${label} AstroDX Charts and Downloads`;
}

export function buildPageMetadata({
  locale,
  pathname,
  title,
  description,
  keywords,
  image,
  imageAlt,
  ogType = "website",
}: PageMetadataOptions): Metadata {
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
      canonical: canonicalUrl,
      languages: buildLanguageAlternates(pathname),
    },
    openGraph: {
      type: ogType,
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
    title: staticSeoTitle(locale, page),
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
    title: buildGuestbookSeoTitle(locale),
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
    title: buildLinksSeoTitle(locale),
    description: dictionary.seo.links,
    keywords: ["AstroDX", siteName, links.title, "maimai", "友情链接", "friend links"],
  });
}

export function buildChartDetailMetadata(locale: Locale, entry: CatalogEntry): Metadata {
  return buildPageMetadata({
    locale,
    pathname: `/charts/${entrySlug(entry)}`,
    title: buildChartDetailSeoTitle(locale, entry),
    description: buildChartDescription(entry, locale),
    keywords: buildDetailKeywords(locale, entry),
    image: entry.media.cover_url || openGraphImageUrl,
    imageAlt: formatEntryTitle(entry, locale),
    ogType: "music.song",
  });
}

export function buildVersionsPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const versions = dictionary.versions;
  return buildPageMetadata({
    locale,
    pathname: "/versions",
    title: buildVersionsSeoTitle(locale),
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
    title: buildVersionDetailSeoTitle(locale, label),
    description: dictionary.seo.versionDetail(label, count),
    keywords: ["AstroDX", siteName, label, "maimai DX"],
  });
}

export function buildLicensePageMetadata(locale: Locale): Metadata {
  const meta = licensePageMetadata[locale];

  return buildPageMetadata({
    locale,
    pathname: "/license",
    title: meta.title,
    description: meta.description,
    keywords: [
      "AstroDX",
      siteName,
      "license",
      "usage notes",
      "谱面来源",
      "许可说明",
      "maimai",
    ],
  });
}
