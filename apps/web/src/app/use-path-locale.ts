"use client";

import * as React from "react";

import { getHtmlLang, isSupportedLocale, type Locale } from "@/lib/i18n";

/**
 * The locale implied by the current URL, resolved on the client.
 *
 * The static export writes one `404.html` that GitHub Pages serves for every
 * unmatched URL, including `/en/...` and `/ja/...` — so the whole page ships as
 * zh markup and the real locale can only be read from `location` after mount.
 * `enabled` is false everywhere else: a normal route already knows its locale
 * from the segment, and re-deriving it there would only add a render.
 *
 * `document.documentElement.lang` is updated with it, because the rest of the
 * page (font stack per script, screen-reader pronunciation, `:lang()` rules)
 * keys off that attribute and the served HTML says zh-CN.
 */
export function usePathLocale(initial: Locale, enabled: boolean): Locale {
  const [locale, setLocale] = React.useState<Locale>(initial);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    const [firstSegment] = window.location.pathname.split("/").filter(Boolean);
    const derived = firstSegment && isSupportedLocale(firstSegment) ? firstSegment : initial;
    document.documentElement.lang = getHtmlLang(derived);
    if (derived !== locale) {
      // Intentional one-time sync from an external system (the URL) after
      // mount: the SSR markup must stay zh so hydration matches.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLocale(derived);
    }
    // `locale` is deliberately not a dependency: this runs once to adopt the
    // URL's locale, and re-running on every change would fight a later switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, initial]);

  return locale;
}
