// External resource links surfaced in the nav "more" menu, the home hero and
// the footer. Same single-source rationale as community-links.ts.

import type { Locale } from "@/lib/i18n";

// Bilibili walkthrough of browsing/downloading charts and importing them into
// AstroDX.
export const DEMO_VIDEO_URL = "https://www.bilibili.com/video/BV17FNV6EE19";

// Self-hosted storage mirrors maintained by the site owner.
export const CLOUD_DRIVE_URL = "https://cloud.saop.cc/";
export const NET_DISK_URL = "https://drive.saop.cc/";

// The official AstroDX homepage (distinct from ASTRODX_APP_REPOSITORY, the
// GitHub repo linked as "Get AstroDX").
export const ASTRODX_SITE_URL = "https://astrodx.com/";

// The official AstroDX wiki. Its language segments differ from our locale codes
// (zh → "cn", ja → "jp"); only en matches.
export const WIKI_BASE_URL = "https://wiki.astrodx.com";

const WIKI_LANG_SEGMENT: Record<Locale, string> = { zh: "cn", en: "en", ja: "jp" };

// Each locale lands on the most relevant getting-started section exposed by
// that Wiki translation.
const WIKI_DOWNLOAD_TARGET: Record<Locale, { segment: string; heading: string }> = {
  zh: { segment: "cn", heading: "下载游戏" },
  en: { segment: "en", heading: "get-the-game" },
  ja: { segment: "jp", heading: "譜面の入れ方" },
};

export function wikiUrl(locale: Locale): string {
  return `${WIKI_BASE_URL}/${WIKI_LANG_SEGMENT[locale]}`;
}

/** Locale-aware link to the Wiki's AstroDX download/getting-started section. */
export function astroDxDownloadUrl(locale: Locale): string {
  const target = WIKI_DOWNLOAD_TARGET[locale];
  return `${WIKI_BASE_URL}/${target.segment}#${encodeURIComponent(target.heading)}`;
}
