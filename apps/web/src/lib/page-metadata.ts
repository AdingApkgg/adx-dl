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
const homeOpenGraphImageUrl = `${siteUrl}/opengraph-home-v2.png`;
/**
 * The site name is locale-owned: the title suffix, og:site_name and the header
 * lockup all read the same value, so an English page no longer suffixes a
 * Chinese brand name onto an English title.
 */
function siteName(locale: Locale): string {
  return getDictionary(locale).siteName;
}
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
  },
  en: {
    home: "AstroDX Chart Archive, Browser and Download Portal",
    charts: "AstroDX Chart Browser and Download Catalog",
  },
  ja: {
    home: "AstroDX 譜面アーカイブとダウンロード入口",
    charts: "AstroDX 譜面一覧とダウンロードカタログ",
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
    siteName(locale),
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

function buildCommunitySeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "AstroDX 玩家社区与交流群组";
  }
  if (locale === "ja") {
    return "AstroDX プレイヤーコミュニティと交流グループ";
  }
  return "AstroDX Player Community and Groups";
}

function buildDonateSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "捐赠支持 ADX 谱面资源";
  }
  if (locale === "ja") {
    return "ADX 譜面アーカイブへの寄付・サポート";
  }
  return "Support the ADX Chart Archive";
}

function buildAboutSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "关于 ADX 谱面资源";
  }
  if (locale === "ja") {
    return "ADX 譜面アーカイブについて";
  }
  return "About the ADX Chart Archive";
}

function buildGuideSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "AstroDX 安装、下载与导入谱面指南";
  }
  if (locale === "ja") {
    return "AstroDX のインストール・ダウンロード・譜面導入ガイド";
  }
  return "AstroDX Install, Download and Chart Import Guide";
}

function buildMusicSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "AstroDX 谱面音乐库与版本歌单";
  }
  if (locale === "ja") {
    return "AstroDX 譜面のミュージックライブラリとバージョン別プレイリスト";
  }
  return "AstroDX Music Library and Version Playlists";
}

function buildChangelogSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "AstroDX 谱面收录更新日志";
  }
  if (locale === "ja") {
    return "AstroDX 譜面の収録更新履歴";
  }
  return "AstroDX Chart Archive Changelog";
}

function buildPostSeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "AstroDX 谱面投稿";
  }
  if (locale === "ja") {
    return "AstroDX 譜面の投稿";
  }
  return "Submit an AstroDX Chart";
}

function buildSurveySeoTitle(locale: Locale): string {
  if (locale === "zh") {
    return "ADX 谱面资源问卷调查";
  }
  if (locale === "ja") {
    return "ADX 譜面アーカイブのアンケート";
  }
  return "ADX Chart Archive Survey";
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
  const fullTitle = `${title} | ${siteName(locale)}`;
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
      siteName: siteName(locale),
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
  const pageMetadata = getStaticPageMetadata(locale).home;

  return buildPageMetadata({
    locale,
    pathname: pageMetadata.pathname,
    title: staticSeoTitle(locale, "home"),
    description: pageMetadata.description,
    keywords: pageMetadata.keywords,
    image: homeOpenGraphImageUrl,
  });
}

export function buildChartsPageMetadata(locale: Locale): Metadata {
  return buildLocalizedPageMetadata(locale, "charts");
}

export function buildGuestbookPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const guestbook = dictionary.guestbook;
  return buildPageMetadata({
    locale,
    pathname: "/comments",
    title: buildGuestbookSeoTitle(locale),
    description: dictionary.seo.guestbook,
    keywords: ["AstroDX", siteName(locale), guestbook.title, "guestbook", "留言板", "comments"],
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
    keywords: ["AstroDX", siteName(locale), links.title, "maimai", "友情链接", "friend links"],
  });
}

export function buildCommunityPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const community = dictionary.community;
  return buildPageMetadata({
    locale,
    pathname: "/community",
    title: buildCommunitySeoTitle(locale),
    description: dictionary.seo.community,
    keywords: ["AstroDX", siteName(locale), community.title, "maimai", "QQ 群", "Telegram", "community"],
  });
}

export function buildDonatePageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  const donate = dictionary.donate;
  return buildPageMetadata({
    locale,
    pathname: "/donate",
    title: buildDonateSeoTitle(locale),
    description: dictionary.seo.donate,
    keywords: ["AstroDX", siteName(locale), donate.title, "爱发电", "Patreon", "USDT", "donate"],
  });
}

export function buildAboutPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  return buildPageMetadata({
    locale,
    pathname: "/about",
    title: buildAboutSeoTitle(locale),
    description: dictionary.seo.about,
    keywords: ["AstroDX", siteName(locale), dictionary.about.title, "maimai", "关于", "about"],
  });
}

export function buildGuidePageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  return buildPageMetadata({
    locale,
    pathname: "/guide",
    title: buildGuideSeoTitle(locale),
    description: dictionary.seo.guide,
    keywords: [
      "AstroDX",
      siteName(locale),
      dictionary.guide.title,
      "maimai",
      "安装",
      "导入谱面",
      "install",
      "import charts",
      "troubleshooting",
    ],
  });
}

export function buildMusicPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  return buildPageMetadata({
    locale,
    pathname: "/music",
    title: buildMusicSeoTitle(locale),
    description: dictionary.seo.music,
    keywords: [
      "AstroDX",
      siteName(locale),
      dictionary.music.title,
      "maimai",
      "歌单",
      "playlist",
      "music",
    ],
  });
}

export function buildChangelogPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  return buildPageMetadata({
    locale,
    pathname: "/changelog",
    title: buildChangelogSeoTitle(locale),
    description: dictionary.seo.changelog,
    keywords: [
      "AstroDX",
      siteName(locale),
      dictionary.changelog.title,
      "maimai",
      "更新日志",
      "changelog",
      "new charts",
    ],
  });
}

export function buildPostPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  return buildPageMetadata({
    locale,
    pathname: "/post",
    title: buildPostSeoTitle(locale),
    description: dictionary.seo.post,
    keywords: ["AstroDX", siteName(locale), dictionary.post.title, "maimai", "投稿", "submit"],
  });
}

export function buildSurveyPageMetadata(locale: Locale): Metadata {
  const dictionary = getDictionary(locale);
  return buildPageMetadata({
    locale,
    pathname: "/survey",
    title: buildSurveySeoTitle(locale),
    description: dictionary.seo.survey,
    keywords: ["AstroDX", siteName(locale), dictionary.survey.title, "maimai", "问卷", "survey", "feedback"],
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
    keywords: ["AstroDX", siteName(locale), versions.title, "maimai DX"],
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
      siteName(locale),
      "license",
      "usage notes",
      "谱面来源",
      "许可说明",
      "maimai",
    ],
  });
}
