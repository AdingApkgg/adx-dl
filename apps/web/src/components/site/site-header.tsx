"use client";

import Link from "next/link";
import Image from "next/image";
import { DownloadIcon, LayersIcon, LibraryBigIcon, SearchIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/site/theme-toggle";
import {
  defaultLocale,
  getDictionary,
  getHtmlLang,
  locales,
  switchLocale,
  type Locale,
} from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SiteHeaderProps = {
  totalEntries: number;
};

export function SiteHeader({ totalEntries }: SiteHeaderProps) {
  const pathname = usePathname() ?? "/";
  const locale = getLocaleFromPathname(pathname);
  const dictionary = getDictionary(locale);
  const homeHref = switchLocale("/", locale);
  const browseHref = switchLocale("/charts", locale);
  const versionsHref = switchLocale("/versions", locale);
  const searchHref = switchLocale("/search", locale);

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <Link href={homeHref} className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
              <Image
                src="/brand-icon.png"
                alt=""
                aria-hidden="true"
                className="size-7 rounded-md"
                width={28}
                height={28}
              />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-wide text-primary">
                ADX 谱面资源
              </span>
              <span className="text-sm text-muted-foreground">
                {dictionary.home.tagline}
              </span>
            </div>
          </Link>
          <Badge variant="secondary">{dictionary.home.entriesBadge(totalEntries)}</Badge>
        </div>
        <nav aria-label={dictionary.nav.primaryLabel} className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href={homeHref}>
              <LibraryBigIcon data-icon="inline-start" />
              {dictionary.nav.home}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={browseHref}>
              <DownloadIcon data-icon="inline-start" />
              {dictionary.nav.browse}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={versionsHref}>
              <LayersIcon data-icon="inline-start" />
              {dictionary.versions.navLabel}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={searchHref}>
              <SearchIcon data-icon="inline-start" />
              {dictionary.nav.search}
            </Link>
          </Button>
        </nav>
        <div className="flex items-center gap-2">
          <nav
            aria-label={dictionary.nav.languageLabel}
            className="hidden items-center gap-1 md:flex"
          >
            {locales.map((targetLocale) => (
              <Button
                key={targetLocale}
                variant={targetLocale === locale ? "secondary" : "outline"}
                size="sm"
                asChild
              >
                <Link
                  href={switchLocale(pathname, targetLocale)}
                  aria-current={targetLocale === locale ? "true" : undefined}
                  lang={getHtmlLang(targetLocale)}
                >
                  {dictionary.language[targetLocale]}
                </Link>
              </Button>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function getLocaleFromPathname(pathname: string): Locale {
  const [firstSegment] = pathname.split("/").filter(Boolean);

  if (firstSegment && locales.includes(firstSegment as Locale)) {
    return firstSegment as Locale;
  }

  return defaultLocale;
}
