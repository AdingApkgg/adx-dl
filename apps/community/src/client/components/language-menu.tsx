import { Button } from "@astrodx/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@astrodx/ui/components/dropdown-menu";
import { CheckIcon, LanguagesIcon } from "lucide-react";
import { useLocation } from "react-router";

import { m } from "@/paraglide/messages.js";
import { deLocalizeHref, getLocale, type Locale, locales, localizeHref } from "@/paraglide/runtime.js";
import { htmlLang } from "@/shared/i18n/locale";

import { dismissLocalePrompt } from "../lib/locale-suggestion";

const LANGUAGE_NAMES: Record<Locale, () => string> = {
  zh: m.language_zh,
  en: m.language_en,
  ja: m.language_ja,
};

export function languageName(locale: Locale): string {
  return LANGUAGE_NAMES[locale]();
}

/** 同一个页面在三种语言下的地址（spec 第 7.2 节：切换后留在同一个页面，查询串照带）。 */
export function languageLinks(pathAndSearch: string): { locale: Locale; href: string }[] {
  const base = deLocalizeHref(pathAndSearch);
  return locales.map((locale) => ({ locale, href: localizeHref(base, { locale }) }));
}

// 页头的语言切换。用普通链接整页跳转（spec 第 11.1 节）：站内路由切换时，没有重新渲染的组件会停在旧语言。
// 点了就记下"用户自己选过语言"，以后不再提示切换（spec 第 7.2 节）。
export function LanguageMenu() {
  const location = useLocation();
  const current = getLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={m.nav_language({ language: languageName(current) })}>
          <LanguagesIcon aria-hidden="true" />
          <span className="hidden sm:inline">{languageName(current)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent instant>
        {languageLinks(`${location.pathname}${location.search}`).map(({ locale, href }) => (
          <DropdownMenuItem key={locale} asChild>
            <a
              href={href}
              hrefLang={htmlLang(locale)}
              lang={htmlLang(locale)}
              aria-current={locale === current ? "true" : undefined}
              onClick={dismissLocalePrompt}
            >
              {languageName(locale)}
              {locale === current ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
