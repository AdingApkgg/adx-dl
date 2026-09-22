import content from "@content/community.json";

import type { Locale } from "@/lib/i18n";

export type CommunityChannel = {
  name: Record<Locale, string>;
  url: string;
  description: Record<Locale, string>;
};

// Shared community entry points — also used by the site header's Telegram
// button and the footer, so the URLs live here rather than per-component.
export const QQ_COMMUNITY = "https://qm.qq.com/q/xltNzTdL1u";
export const TELEGRAM_COMMUNITY = "https://t.me/FullDiveSAO";

// This site's own repository. Its issue tracker is the third contact route
// beside the two chat groups — and the one a rights holder or a bug reporter
// can use without joining anything — so it lives with them rather than being
// re-declared next to every surface that links it.
export const SITE_REPOSITORY = "https://github.com/AdingApkgg/adx-dl";
export const SITE_ISSUES_URL = `${SITE_REPOSITORY}/issues`;

/** The three ways to reach the maintainer, in the order every page lists them. */
export const contactChannels = content.contactChannels satisfies {
  name: Record<Locale, string>;
  url: string;
}[];

// Rendered on /community. Order follows editorial intent.
export const communityChannels = content.communityChannels satisfies CommunityChannel[];
