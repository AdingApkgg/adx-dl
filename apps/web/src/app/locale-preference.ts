import { isSupportedLocale, type Locale } from "@/lib/i18n";

// Written by the language switcher on an explicit pick; read by the suggestion
// banner. Storage access is wrapped: Safari private mode / blocked storage throws.
const PREFERRED_LOCALE_KEY = "preferred-locale";
const BANNER_DISMISSED_KEY = "preferred-locale-banner-dismissed";

export function readPreferredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(PREFERRED_LOCALE_KEY);
    return value && isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storePreferredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(PREFERRED_LOCALE_KEY, locale);
  } catch {
    // Ignore blocked storage — the choice simply won't persist.
  }
}

export function readLocaleBannerDismissed(): boolean {
  try {
    return window.localStorage.getItem(BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeLocaleBannerDismissed(): void {
  try {
    window.localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  } catch {
    // Ignore blocked storage.
  }
}
