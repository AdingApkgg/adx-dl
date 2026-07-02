"use client";

import * as React from "react";
import { XIcon } from "lucide-react";

import {
  readLocaleBannerDismissed,
  readPreferredLocale,
  storeLocaleBannerDismissed,
  storePreferredLocale,
} from "@/app/locale-preference";
import { buildLocalePath, getDictionary, type PrefixedLocale } from "@/lib/i18n";

/**
 * One-line suggestion bar shown on the zh (default) tree when the visitor's
 * stored choice or browser language is en/ja: offers a link to the same page
 * in that locale. Never redirects automatically; dismissal is remembered.
 * Renders nothing until mounted, so the static zh HTML is unaffected.
 */
export function LocaleSuggestionBanner() {
  const [target, setTarget] = React.useState<PrefixedLocale | null>(null);
  const [href, setHref] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (readLocaleBannerDismissed()) return;
    const stored = readPreferredLocale();
    // An explicit zh pick wins over the browser language: stay quiet.
    if (stored === "zh") return;
    let candidate: PrefixedLocale | null =
      stored === "en" || stored === "ja" ? stored : null;
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
  }, []);

  if (!target || !href) return null;

  const banner = getDictionary(target).localeBanner;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-border/60 bg-primary/10 px-4 py-1.5 text-sm">
      <a
        href={href}
        lang={target}
        className="font-medium text-primary underline-offset-4 hover:underline"
        onClick={() => storePreferredLocale(target)}
      >
        {banner.continueIn}
      </a>
      <button
        type="button"
        aria-label={banner.dismiss}
        className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => {
          storeLocaleBannerDismissed();
          setTarget(null);
        }}
      >
        <XIcon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
