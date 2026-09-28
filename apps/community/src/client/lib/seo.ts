import { baseLocale, deLocalizeHref, type Locale, locales, localizeHref } from "@/paraglide/runtime.js";
import { htmlLang, ogLocale } from "@/shared/i18n/locale";

type MatchLike = { id: string; loaderData?: unknown } | undefined;

// 站点地址（PUBLIC_ORIGIN）部署后不变，所以根 loader 在站内跳转时不重新执行也没关系。
export function originFrom(matches: readonly MatchLike[]): string {
  const data = matches.find((match) => match?.id === "root")?.loaderData as { origin?: string } | undefined;
  return data?.origin ?? "";
}

function trimTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function canonicalLink(origin: string, pathname: string) {
  return { tagName: "link", rel: "canonical", href: `${origin}${trimTrailingSlash(pathname)}` } as const;
}

// 每个页面都输出三种语言版本的互相链接（spec 第 11.1 节）。
export function localeAlternates(origin: string, pathname: string) {
  const base = deLocalizeHref(pathname);
  const hrefFor = (locale: Locale) => `${origin}${trimTrailingSlash(localizeHref(base, { locale }))}`;
  return [
    ...locales.map(
      (locale) => ({ tagName: "link", rel: "alternate", hrefLang: htmlLang(locale), href: hrefFor(locale) }) as const
    ),
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: hrefFor(baseLocale) } as const,
  ];
}

export function openGraph(input: { title: string; description: string; url: string; locale: Locale; siteName: string }) {
  return [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: input.siteName },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: input.url },
    { property: "og:locale", content: ogLocale(input.locale) },
  ];
}
