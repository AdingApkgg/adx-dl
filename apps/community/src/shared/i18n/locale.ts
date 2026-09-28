import type { Locale } from "@/paraglide/runtime.js";

// lang 决定浏览器给汉字选哪套字形（简体中文和日文的写法不一样），中文页面要写明 zh-CN。
const HTML_LANG = { zh: "zh-CN", en: "en", ja: "ja" } as const satisfies Record<Locale, string>;

// og:locale 要求"语言_地区"的写法。
const OG_LOCALE = { zh: "zh_CN", en: "en_US", ja: "ja_JP" } as const satisfies Record<Locale, string>;

export function htmlLang(locale: Locale): (typeof HTML_LANG)[Locale] {
  return HTML_LANG[locale];
}

export function ogLocale(locale: Locale): (typeof OG_LOCALE)[Locale] {
  return OG_LOCALE[locale];
}
