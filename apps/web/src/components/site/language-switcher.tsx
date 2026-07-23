"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, GlobeIcon } from "lucide-react";

import { storePreferredLocale } from "@/app/locale-preference";
import { EASE_OUT, motion, springSoft } from "@/components/motion";
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

// framer-motion 12: motion() is removed, wrap components via motion.create.
const MotionButton = motion.create(Button);

const globeWobble = {
  hover: { rotate: [0, -12, 10, 0], transition: { duration: 0.6, ease: EASE_OUT } },
};

export function LanguageSwitcher({ locale, pathname }: LanguageSwitcherProps) {
  const router = useRouter();
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
    router.push(`${switchLocale(pathname, targetLocale)}${search}${hash}`, {
      scroll: false,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MotionButton
          variant="outline"
          size="icon-sm"
          className="gap-1 sm:w-auto sm:px-2.5"
          aria-label={dictionary.nav.languageLabel}
          title={dictionary.nav.languageLabel}
          whileHover="hover"
          whileTap={{ scale: 0.94 }}
          transition={springSoft}
        >
          {/* The "hover" variant propagates from the button, so the globe
              wobbles while the button itself only scales on tap. */}
          <motion.span variants={globeWobble} className="inline-flex">
            <GlobeIcon />
          </motion.span>
          <span className="hidden text-xs font-medium sm:inline">
            {localeShortLabel[locale]}
          </span>
        </MotionButton>
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
                {/* Menu content mounts on open, so the check pops every time
                    the menu opens — client-only UI, nothing serialized. */}
                {isActive ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={springSoft}
                    className="ml-auto inline-flex"
                  >
                    <CheckIcon />
                  </motion.span>
                ) : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
