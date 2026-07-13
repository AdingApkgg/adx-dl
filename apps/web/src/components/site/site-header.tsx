"use client";

import * as React from "react";
import Link from "next/link";
import {
  DownloadIcon,
  EllipsisIcon,
  LayersIcon,
  LibraryBigIcon,
  MenuIcon,
  SendIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
} from "framer-motion";

import { EASE_OUT, motion, springSoft } from "@/components/motion";
import { CompatibleImage, compatibleSourcesFromPng } from "@/components/site/compatible-image";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { ThemeToggle } from "@/components/site/theme-toggle";
import {
  defaultLocale,
  getDictionary,
  locales,
  switchLocale,
  type Locale,
} from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TELEGRAM_COMMUNITY = "https://t.me/FullDiveSAO";

// Compact-on-scroll thresholds (px). Enter/exit differ by ~16px of hysteresis
// so the header doesn't flicker when the page rests near the boundary.
const COMPACT_ENTER = 64;
const COMPACT_EXIT = 48;

type SiteHeaderProps = {
  totalEntries: number;
};

type NavItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  exact?: boolean;
};

export function SiteHeader({ totalEntries }: SiteHeaderProps) {
  const pathname = usePathname() ?? "/";
  const locale = getLocaleFromPathname(pathname);
  const dictionary = getDictionary(locale);
  const prefersReducedMotion = useReducedMotion();

  // Starts expanded (matching the SSR HTML) and compacts once scrolled.
  const [compact, setCompact] = React.useState(false);
  const { scrollY, scrollYProgress } = useScroll();
  const progressScale = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 26,
    restDelta: 0.001,
  });

  useMotionValueEvent(scrollY, "change", (y) => {
    setCompact((prev) => (prev ? y > COMPACT_EXIT : y > COMPACT_ENTER));
  });

  React.useEffect(() => {
    // "change" never fires for a page restored mid-scroll (bfcache, #anchor
    // loads), so sync once from the live value after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (scrollY.get() > COMPACT_ENTER) setCompact(true);
  }, [scrollY]);

  const primaryNav: NavItem[] = [
    {
      href: switchLocale("/", locale),
      label: dictionary.nav.home,
      icon: <LibraryBigIcon data-icon="inline-start" />,
      exact: true,
    },
    {
      href: switchLocale("/charts", locale),
      label: dictionary.nav.browse,
      icon: <DownloadIcon data-icon="inline-start" />,
    },
    {
      href: switchLocale("/versions", locale),
      label: dictionary.versions.navLabel,
      icon: <LayersIcon data-icon="inline-start" />,
    },
  ];
  const secondaryNav: NavItem[] = [
    { href: switchLocale("/status", locale), label: dictionary.statusPage.title },
    { href: switchLocale("/comments", locale), label: dictionary.guestbook.navLabel },
    { href: switchLocale("/links", locale), label: dictionary.links.navLabel },
  ];

  const isActive = (item: NavItem) => {
    const current = trimTrailingSlash(pathname);
    const target = trimTrailingSlash(item.href);
    if (item.exact) return current === target;
    return current === target || current.startsWith(`${target}/`);
  };

  return (
    // view-transition-name pins the chrome during the branded page transition
    // (globals.css animates only the root snapshot around it).
    <header
      style={{ viewTransitionName: "site-header" }}
      className={cn(
        "sticky top-0 z-20 border-b backdrop-blur transition-colors duration-300",
        compact ? "border-border bg-background/95" : "border-border/60 bg-background/90"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6",
          "transition-[padding] duration-300 motion-reduce:transition-none",
          compact ? "py-1.5" : "py-3"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Link href={primaryNav[0].href} className="group flex min-w-0 items-center gap-3">
            <motion.div
              animate={{ scale: compact ? 0.85 : 1 }}
              whileHover={{ scale: 1.06, rotate: -3 }}
              whileTap={{ scale: 0.95 }}
              transition={springSoft}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"
            >
              <CompatibleImage
                sources={compatibleSourcesFromPng("/brand-icon.png")}
                alt=""
                aria-hidden="true"
                className="size-7 rounded-md"
                width={28}
                height={28}
              />
            </motion.div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold tracking-wide text-primary">
                ADX 谱面资源
              </span>
              {/* Wraps mid-word on narrow phones — the badge and menu need the room more. */}
              {/* Decorative tagline collapses when compact; initial={false} keeps the
                  SSR HTML fully expanded and visible. */}
              <motion.span
                initial={false}
                animate={compact ? { opacity: 0, height: 0 } : { opacity: 1, height: "auto" }}
                // MotionConfig only drops transform/layout animations — the
                // height tween would persist, so zero it out by hand.
                transition={{ duration: prefersReducedMotion ? 0 : 0.25, ease: EASE_OUT }}
                className="hidden truncate text-sm text-muted-foreground sm:block"
              >
                {dictionary.home.tagline}
              </motion.span>
            </div>
          </Link>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {dictionary.home.entriesBadge(totalEntries)}
          </Badge>
        </div>
        <nav aria-label={dictionary.nav.primaryLabel} className="hidden items-center gap-2 md:flex">
          {primaryNav.map((item) => {
            const active = isActive(item);
            return (
              <Button
                key={item.href}
                variant="ghost"
                size="sm"
                asChild
                className={cn(active && "bg-secondary text-secondary-foreground")}
              >
                <Link href={item.href} aria-current={active ? "page" : undefined}>
                  {item.icon}
                  {item.label}
                </Link>
              </Button>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={dictionary.nav.moreLabel}
                className={cn(
                  secondaryNav.some(isActive) && "bg-secondary text-secondary-foreground"
                )}
              >
                <EllipsisIcon data-icon="inline-start" />
                {dictionary.nav.moreLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {secondaryNav.map((item) => (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={item.href} aria-current={isActive(item) ? "page" : undefined}>
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher locale={locale} pathname={pathname} />
          <Button variant="outline" size="icon-sm" asChild className="hidden sm:inline-flex">
            <a
              href={TELEGRAM_COMMUNITY}
              target="_blank"
              rel="noreferrer"
              aria-label={dictionary.nav.community}
              title={dictionary.nav.community}
            >
              <SendIcon />
            </a>
          </Button>
          <ThemeToggle labels={dictionary.theme} />
          {/* Mobile: the primary nav above is hidden below md, so every page must
              stay reachable from this menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="md:hidden"
                aria-label={dictionary.nav.menuLabel}
                title={dictionary.nav.menuLabel}
              >
                <MenuIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={dictionary.nav.primaryLabel}>
              {primaryNav.map((item) => {
                const active = isActive(item);
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      data-state={active ? "checked" : undefined}
                    >
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              {secondaryNav.map((item) => {
                const active = isActive(item);
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      data-state={active ? "checked" : undefined}
                    >
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={TELEGRAM_COMMUNITY} target="_blank" rel="noreferrer">
                  {dictionary.nav.community}
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Scroll progress along the header's bottom edge. Style-bound motion
          value, so it must be gated by useReducedMotion by hand. */}
      {prefersReducedMotion ? null : (
        <motion.div
          aria-hidden="true"
          style={{ scaleX: progressScale }}
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
        />
      )}
    </header>
  );
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function getLocaleFromPathname(pathname: string): Locale {
  const [firstSegment] = pathname.split("/").filter(Boolean);

  if (firstSegment && locales.includes(firstSegment as Locale)) {
    return firstSegment as Locale;
  }

  return defaultLocale;
}
