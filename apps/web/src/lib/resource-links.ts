// External resource links surfaced in the nav "more" menu, the home hero and
// the footer. Same single-source rationale as community-links.ts.

import type { Locale } from "@/lib/i18n";

// Bilibili walkthrough of browsing/downloading charts and importing them into
// AstroDX.
export const DEMO_VIDEO_URL = "https://www.bilibili.com/video/BV17FNV6EE19";

// Bilibili walkthrough dedicated to importing a downloaded .adx into AstroDX —
// narrower than DEMO_VIDEO_URL, which tours the whole browse → import flow.
export const CHART_IMPORT_VIDEO_URL = "https://www.bilibili.com/video/BV1sPtF6mE24";

// Self-hosted storage mirrors maintained by the site owner.
export const CLOUD_DRIVE_URL = "https://cloud.saop.cc/";
export const NET_DISK_URL = "https://drive.saop.cc/";

// The official AstroDX homepage (distinct from ASTRODX_APP_REPOSITORY, the
// GitHub repo linked as "Get AstroDX").
export const ASTRODX_SITE_URL = "https://astrodx.com/";

/**
 * Where AstroDX itself is distributed, per the wiki's "Get the Game" section.
 *
 * iOS moved from a TestFlight beta to a public App Store listing (the wiki's
 * `content/index.mdx` commit "feat: Change TestFlight link to App Store",
 * 2026-05-16). The per-platform install pages on that same wiki still describe
 * the TestFlight flow and were last touched in April — the homepage is the
 * current one. Anything on this site that talks about installing the app must
 * follow the homepage, not those pages.
 */
export const ASTRODX_APP_STORE_URL = "https://apps.apple.com/app/astrodx/id6754203760";
export const ASTRODX_RELEASES_URL = "https://github.com/2394425147/astrodx/releases";
/** Bug reports about the APP (ours live in SITE_ISSUES_URL). */
export const ASTRODX_APP_ISSUES_URL = "https://github.com/2394425147/astrodx/issues/new/choose";

// The official AstroDX wiki. Its language segments differ from our locale codes
// (zh → "cn", ja → "jp"); only en matches.
export const WIKI_BASE_URL = "https://wiki.astrodx.com";

const WIKI_LANG_SEGMENT: Record<Locale, string> = { zh: "cn", en: "en", ja: "jp" };

/** The wiki's per-platform chart-install walkthrough, in the reader's language. */
export function wikiInstallUrl(locale: Locale, platform: "android" | "ios"): string {
  return `${WIKI_BASE_URL}/${WIKI_LANG_SEGMENT[locale]}/install/${platform}`;
}

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
