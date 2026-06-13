import { notFound } from "next/navigation";

import { isSupportedLocale, prefixedLocales, type PrefixedLocale } from "@/lib/i18n";

export function generatePrefixedLocaleParams() {
  return prefixedLocales.map((locale) => ({ locale }));
}

export function getPrefixedRouteLocale(locale: string): PrefixedLocale {
  if (!isSupportedLocale(locale) || locale === "zh") {
    notFound();
  }

  return locale as PrefixedLocale;
}

export function buildLocalizedDetailStaticParams(slugs: string[]) {
  return prefixedLocales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}
