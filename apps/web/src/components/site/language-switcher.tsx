"use client";

import Link from "next/link";
import { CheckIcon, GlobeIcon } from "lucide-react";

import { storePreferredLocale } from "@/app/locale-preference";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getDictionary,
  getHtmlLang,
  locales,
  switchLocale,
  type Locale,
} from "@/lib/i18n";

type LanguageSwitcherProps = {
  locale: Locale;
  pathname: string;
};

// Compact current-locale badge shown next to the globe on wider viewports.
const localeShortLabel: Record<Locale, string> = {
  zh: "中",
  en: "EN",
  ja: "日",
};

export function LanguageSwitcher({ locale, pathname }: LanguageSwitcherProps) {
  const dictionary = getDictionary(locale);

  const handleSelect = (
    event: React.MouseEvent<HTMLAnchorElement>,
    targetLocale: Locale
  ) => {
    // Remember the explicit pick even for modified clicks (new tab, etc.).
    storePreferredLocale(targetLocale);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    // The Link href only carries the pathname; re-read the location at click
    // time so active filters (?q=&genre=…) and anchors survive the switch.
    const { search, hash } = window.location;
    if (!search && !hash) {
      return;
    }
    event.preventDefault();
    window.location.assign(`${switchLocale(pathname, targetLocale)}${search}${hash}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="gap-1 sm:w-auto sm:px-2.5"
          aria-label={dictionary.nav.languageLabel}
          title={dictionary.nav.languageLabel}
        >
          <GlobeIcon />
          <span className="hidden text-xs font-medium sm:inline">
            {localeShortLabel[locale]}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {locales.map((targetLocale) => {
          const isActive = targetLocale === locale;
          return (
            <DropdownMenuItem key={targetLocale} asChild>
              <Link
                href={switchLocale(pathname, targetLocale)}
                lang={getHtmlLang(targetLocale)}
                aria-current={isActive ? "true" : undefined}
                data-state={isActive ? "checked" : undefined}
                onClick={(event) => handleSelect(event, targetLocale)}
              >
                {dictionary.language[targetLocale]}
                {isActive ? <CheckIcon className="ml-auto" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
