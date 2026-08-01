"use client";

import * as React from "react";
import Link from "next/link";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  ClipboardListIcon,
  CloudIcon,
  DicesIcon,
  DownloadIcon,
  EllipsisIcon,
  Gamepad2Icon,
  HardDriveIcon,
  HeartHandshakeIcon,
  InfoIcon,
  LayersIcon,
  LibraryBigIcon,
  Link2Icon,
  MenuIcon,
  MessageSquareIcon,
  PlayCircleIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useMotionValueEvent,
  useScroll,
  useSpring,
} from "framer-motion";

import { EASE_OUT, motion, springSoft, useReducedMotion } from "@/components/motion";
import {
  ASTRODX_SITE_URL,
  CLOUD_DRIVE_URL,
  DEMO_VIDEO_URL,
  NET_DISK_URL,
  wikiUrl,
} from "@/lib/resource-links";
import { CompatibleImage, compatibleSourcesFromPng } from "@/components/site/compatible-image";
import { HEADER_ACTION_CLASS } from "@/components/site/header-actions";
import { useRandomChartNavigation } from "@/components/site/random-chart-button";
import { SiteSettingsPanel } from "@/components/site/site-settings-panel";
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

// External monitor page; the in-site /status route was removed in favour of a
// direct link to the public dashboard.
const SERVER_STATUS_URL = "https://s.saop.cc/server/66";

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
  external?: boolean;
};

export function SiteHeader({ totalEntries }: SiteHeaderProps) {
  const pathname = usePathname() ?? "/";
  const locale = getLocaleFromPathname(pathname);
  const dictionary = getDictionary(locale);
  const prefersReducedMotion = useReducedMotion();
  const { busy: randomBusy, navigateToRandomChart } = useRandomChartNavigation(locale);

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
  // Search has no page of its own: it deep-links to the browse catalog with
  // ?focus=search, which CatalogBrowser reads once on mount to put the cursor
  // in its filter box (and then drops from the URL).
  const chartsHref = switchLocale("/charts", locale);
  const searchItem: NavItem = {
    href: `${chartsHref}?focus=search`,
    label: dictionary.nav.searchLabel,
    icon: <SearchIcon data-icon="inline-start" />,
  };
  // Clicking it while already on the browse page navigates within the same
  // route, so nothing remounts: the mount-time handler never runs, focus stays
  // on the button and ?focus=search sticks to the URL. Focus the box directly
  // instead. Must sit on the Link — Next.js calls the child's onClick first and
  // skips navigation if it was prevented.
  const onSearchClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (trimTrailingSlash(pathname) !== trimTrailingSlash(chartsHref)) return;
    const input = document.querySelector<HTMLInputElement>("input[data-catalog-search]");
    if (!input) return;
    event.preventDefault();
    input.focus();
  };
  // The "more" menu, grouped: resources / community / site. Rendered with a
  // separator between groups in both the desktop dropdown and the mobile menu.
  const secondaryNavGroups: NavItem[][] = [
    [
      {
        href: ASTRODX_SITE_URL,
        label: dictionary.resources.official,
        icon: <Gamepad2Icon />,
        external: true,
      },
      {
        href: wikiUrl(locale),
        label: dictionary.resources.wiki,
        icon: <BookOpenIcon />,
        external: true,
      },
      {
        href: DEMO_VIDEO_URL,
        label: dictionary.resources.video,
        icon: <PlayCircleIcon />,
        external: true,
      },
      {
        href: CLOUD_DRIVE_URL,
        label: dictionary.resources.cloudDrive,
        icon: <CloudIcon />,
        external: true,
      },
      {
        href: NET_DISK_URL,
        label: dictionary.resources.netDisk,
        icon: <HardDriveIcon />,
        external: true,
      },
    ],
    [
      {
        href: switchLocale("/community", locale),
        label: dictionary.community.navLabel,
        icon: <UsersIcon />,
      },
      {
        href: switchLocale("/comments", locale),
        label: dictionary.guestbook.navLabel,
        icon: <MessageSquareIcon />,
      },
      {
        href: switchLocale("/post", locale),
        label: dictionary.post.navLabel,
        icon: <UploadIcon />,
      },
      {
        href: switchLocale("/survey", locale),
        label: dictionary.survey.navLabel,
        icon: <ClipboardListIcon />,
      },
    ],
    [
      {
        href: switchLocale("/links", locale),
        label: dictionary.links.navLabel,
        icon: <Link2Icon />,
      },
      {
        href: switchLocale("/donate", locale),
        label: dictionary.donate.navLabel,
        icon: <HeartHandshakeIcon />,
      },
      {
        href: switchLocale("/about", locale),
        label: dictionary.about.navLabel,
        icon: <InfoIcon />,
      },
      {
        href: SERVER_STATUS_URL,
        label: dictionary.statusPage.title,
        icon: <ActivityIcon />,
        external: true,
      },
    ],
  ];
  const secondaryNav: NavItem[] = secondaryNavGroups.flat();

  const isActive = (item: NavItem) => {
    if (item.external) return false;
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
        data-motion-sensitive=""
        className={cn(
          "mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6",
          "transition-[padding] duration-300",
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
            <DropdownMenuContent
              align="end"
              collisionPadding={8}
              className="w-[min(34rem,calc(100vw-2rem))] p-2"
            >
              <div className="grid grid-cols-3 gap-2">
                {secondaryNavGroups.map((group) => (
                  <div
                    key={group[0].href}
                    className="grid min-w-0 content-start gap-0.5 border-l border-border/70 pl-2 first:border-l-0 first:pl-0"
                  >
                    {group.map((item) => (
                      <DropdownMenuItem
                        key={item.href}
                        asChild
                        className="min-w-0 whitespace-normal py-2 leading-snug"
                      >
                        {item.external ? (
                          <a href={item.href} target="_blank" rel="noreferrer">
                            <NavItemContent item={item} showExternal />
                          </a>
                        ) : (
                          <Link
                            href={item.href}
                            aria-current={isActive(item) ? "page" : undefined}
                          >
                            <NavItemContent item={item} />
                          </Link>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {/* Search and random sit with the trailing controls rather than in the
              nav, and stay reachable at every width — so neither is repeated in
              the mobile menu below. */}
          <Button
            variant="outline"
            size="sm"
            asChild
            aria-label={searchItem.label}
            title={searchItem.label}
            className={HEADER_ACTION_CLASS}
          >
            <Link href={searchItem.href} onClick={onSearchClick}>
              <SearchIcon aria-hidden="true" />
              <span className="hidden md:inline">{searchItem.label}</span>
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={navigateToRandomChart}
            disabled={randomBusy}
            aria-label={dictionary.nav.randomLabel}
            title={dictionary.nav.randomLabel}
            className={HEADER_ACTION_CLASS}
          >
            <DicesIcon className={cn(randomBusy && "animate-spin")} aria-hidden="true" />
            <span className="hidden md:inline">{dictionary.nav.randomLabel}</span>
          </Button>
          <SiteSettingsPanel
            locale={locale}
            pathname={pathname}
            dictionary={dictionary}
          />
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
            <DropdownMenuContent
              align="end"
              collisionPadding={8}
              aria-label={dictionary.nav.primaryLabel}
              className="max-h-[min(36rem,calc(100dvh-5rem))] w-[min(30rem,calc(100vw-1rem))] overscroll-contain p-2"
            >
              <div className="grid grid-cols-2 items-start gap-2">
                <div className="min-w-0">
                  <div
                    role="group"
                    aria-label={dictionary.nav.primaryLabel}
                    className="grid gap-0.5"
                  >
                    {primaryNav.map((item) => {
                      const active = isActive(item);
                      return (
                        <DropdownMenuItem
                          key={item.href}
                          asChild
                          className="min-h-11 min-w-0 whitespace-normal px-3 py-2.5 leading-snug"
                        >
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            data-state={active ? "checked" : undefined}
                          >
                            <NavItemContent item={item} />
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                  <DropdownMenuSeparator />
                  <div
                    role="group"
                    aria-label={dictionary.nav.moreLabel}
                    className="grid gap-0.5"
                  >
                    {secondaryNavGroups[0].map((item) => (
                      <DropdownMenuItem
                        key={item.href}
                        asChild
                        className="min-h-11 min-w-0 whitespace-normal px-3 py-2.5 leading-snug"
                      >
                        <a href={item.href} target="_blank" rel="noreferrer">
                          <NavItemContent item={item} showExternal />
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </div>

                <div className="min-w-0">
                  <div
                    role="group"
                    aria-label={dictionary.community.navLabel}
                    className="grid gap-0.5"
                  >
                    {secondaryNavGroups[1].map((item) => {
                      const active = isActive(item);
                      return (
                        <DropdownMenuItem
                          key={item.href}
                          asChild
                          className="min-h-11 min-w-0 whitespace-normal px-3 py-2.5 leading-snug"
                        >
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            data-state={active ? "checked" : undefined}
                          >
                            <NavItemContent item={item} />
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                  <DropdownMenuSeparator />
                  <div
                    role="group"
                    aria-label={dictionary.footer.navLabel}
                    className="grid gap-0.5"
                  >
                    {secondaryNavGroups[2].map((item) => {
                      const active = isActive(item);
                      return (
                        <DropdownMenuItem
                          key={item.href}
                          asChild
                          className="min-h-11 min-w-0 whitespace-normal px-3 py-2.5 leading-snug"
                        >
                          {item.external ? (
                            <a href={item.href} target="_blank" rel="noreferrer">
                              <NavItemContent item={item} showExternal />
                            </a>
                          ) : (
                            <Link
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              data-state={active ? "checked" : undefined}
                            >
                              <NavItemContent item={item} />
                            </Link>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                </div>
              </div>
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

function NavItemContent({
  item,
  showExternal = false,
}: {
  item: NavItem;
  showExternal?: boolean;
}) {
  return (
    <>
      {item.icon ? (
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4"
        >
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 break-words">{item.label}</span>
      {showExternal ? (
        // New-tab hint keeps external destinations distinct without making
        // their semantic icon compete for the trailing position.
        <ArrowUpRightIcon
          aria-hidden="true"
          className="ml-auto size-3.5 text-muted-foreground"
        />
      ) : null}
    </>
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
