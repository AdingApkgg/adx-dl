"use client";

import * as React from "react";

import {
  readLocaleBannerDismissed,
  readPreferredLocale,
  storeLocaleBannerDismissed,
  storePreferredLocale,
} from "@/app/locale-preference";
import { buildLocalePath, type PrefixedLocale } from "@/lib/i18n";

export type LocaleSuggestion = {
  target: PrefixedLocale;
  href: string;
  dismiss: () => void;
};

/**
 * Offers the same page in the visitor's preferred language. Only meaningful on
 * the zh (default) tree — the prefixed trees were an explicit choice — so the
 * caller passes `enabled` rather than calling this conditionally.
 */
export function useLocaleSuggestion(enabled: boolean): LocaleSuggestion | null {
  const [target, setTarget] = React.useState<PrefixedLocale | null>(null);
  const [href, setHref] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    if (readLocaleBannerDismissed()) return;
    const stored = readPreferredLocale();
    // An explicit zh pick wins over the browser language: stay quiet.
    if (stored === "zh") return;
    let candidate: PrefixedLocale | null = stored === "en" || stored === "ja" ? stored : null;
    if (!candidate) {
      const language = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
      if (language.startsWith("en")) candidate = "en";
      else if (language.startsWith("ja")) candidate = "ja";
    }
    if (!candidate) return;
    const { pathname, search, hash } = window.location;
    // Intentional one-time sync from external systems (localStorage + URL)
    // after mount — SSR must render nothing to keep the static zh HTML clean.
    /* eslint-disable react-hooks/set-state-in-effect */
    setHref(`${buildLocalePath(pathname, candidate)}${search}${hash}`);
    setTarget(candidate);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [enabled]);

  const dismiss = React.useCallback(() => {
    storeLocaleBannerDismissed();
    setTarget(null);
  }, []);

  if (!target || !href) return null;
  return { target, href, dismiss };
}

export { storePreferredLocale };
