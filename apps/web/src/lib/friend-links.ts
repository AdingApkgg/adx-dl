import content from "@content/friend-links.json";

import type { Locale } from "@/lib/i18n";

export type FriendLink = {
  /**
   * Localized site name. Half of these sites only have a Chinese name in the
   * wild, but the card's accessible name and the /links ItemList JSON-LD are
   * both built from this string — leaving it monolingual meant an English or
   * Japanese reader got a title they could not read, in the markup as well as
   * on screen. A romanized/translated form is used where no official one exists.
   */
  name: Record<Locale, string>;
  url: string;
  description: Record<Locale, string>;
};

// Display-friendly hostname for external-link cards (/links, /community, /donate).
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The AstroDX source repository — linked from the about and community-links
// surfaces. User-facing "Get AstroDX" actions route through the Wiki instead.
export const ASTRODX_APP_REPOSITORY = "https://github.com/2394425147/astrodx";

// Curated maimai / AstroDX community sites and tools. External and unaffiliated;
// rendered on /links and surfaced in the sitemap. Order follows editorial intent.
export const friendLinks = content.links satisfies FriendLink[];
