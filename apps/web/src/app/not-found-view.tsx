"use client";

import { useInView } from "framer-motion";
import Link from "next/link";
import * as React from "react";

import { usePathLocale } from "@/app/use-path-locale";
import { RevealItem, motion, useReducedMotion } from "@/components/motion";
import { HomeHeroSearch } from "@/components/site/home-hero-search";
import { Button } from "@/components/ui/button";
import { buildLocalePath, getDictionary } from "@/lib/i18n";

const GLYPHS = ["4", "0", "4"] as const;

/**
 * Shared 404 content. On GitHub Pages the exported 404.html is one static page
 * served for every unmatched URL (including /en/... and /ja/...), so the locale
 * can only be derived client-side from the real location. The zh SSR markup is
 * kept for the first paint and re-rendered after mount to avoid a hydration
 * mismatch. The page is excluded from indexing, so the theatrics (hidden
 * initial states) carry no SEO cost.
 */
export function NotFoundView() {
  const locale = usePathLocale("zh", true);
  const reducedMotion = useReducedMotion();
  const glyphsRef = React.useRef<HTMLDivElement>(null);
  const glyphsInView = useInView(glyphsRef);
  // MotionConfig reducedMotion="user" does not stop infinite repeat loops, so
  // the idle bob is gated by hand — and paused off-screen / pre-mount.
  const bobbing = !reducedMotion && glyphsInView;

  // A mistyped or truncated CJK slug is by far the likeliest way to reach this
  // page, and the last path segment is usually most of the song title — so it
  // seeds the search box rather than being thrown away.
  const [seedQuery, setSeedQuery] = React.useState("");
  React.useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";
    let decoded = last;
    try {
      decoded = decodeURIComponent(last);
    } catch {
      // A malformed %-sequence in the URL is exactly the sort of typo that
      // lands here; fall back to the raw segment.
    }
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL-derived seed, post-hydration on purpose */
    setSeedQuery(decoded.replace(/[-_]+/g, " ").trim());
  }, []);

  const dictionary = getDictionary(locale);
  const notFound = dictionary.notFound;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <div
        ref={glyphsRef}
        aria-hidden="true"
        className="flex select-none items-baseline justify-center gap-1 sm:gap-1.5"
      >
        {GLYPHS.map((glyph, index) => (
          <motion.span
            key={index}
            className={
              index === 1
                ? "inline-block text-7xl font-bold tracking-tight text-primary sm:text-8xl"
                : "inline-block text-7xl font-bold tracking-tight sm:text-8xl"
            }
            initial={{ opacity: 0, y: -64, rotate: index === 1 ? 10 : -12 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 240,
              damping: 13,
              mass: 0.9,
              delay: 0.1 + index * 0.09,
            }}
          >
            {/* The idle bob lives on an inner span so it never fights the
                entrance spring over the same transform. */}
            <motion.span
              className="inline-block"
              animate={bobbing ? { y: -6 } : { y: 0 }}
              transition={
                bobbing
                  ? {
                      duration: 1.6,
                      ease: "easeInOut",
                      repeat: Infinity,
                      repeatType: "mirror",
                      delay: 1 + index * 0.18,
                    }
                  : { duration: 0.3 }
              }
            >
              {glyph}
            </motion.span>
          </motion.span>
        ))}
      </div>
      <p className="sr-only">404</p>
      <RevealItem delay={0.3}>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {notFound.title}
        </h1>
      </RevealItem>
      <RevealItem delay={0.4}>
        <p className="max-w-md text-sm text-muted-foreground">{notFound.description}</p>
      </RevealItem>
      {/* Keyed on the seed so the input adopts it once it has been read from
          the URL — HomeHeroSearch owns its query state from mount onwards. */}
      <RevealItem delay={0.45} className="w-full max-w-xl text-left">
        <h2 className="sr-only">{notFound.searchLabel}</h2>
        <HomeHeroSearch
          key={seedQuery}
          searchHref={buildLocalePath("/charts", locale)}
          placeholder={dictionary.catalogBrowser.searchPlaceholder}
          submitLabel={notFound.searchSubmit}
          initialQuery={seedQuery}
        />
      </RevealItem>
      <RevealItem
        delay={0.5}
        className="mt-2 flex flex-wrap items-center justify-center gap-2"
      >
        <Button asChild>
          <Link href={buildLocalePath("/", locale)}>{notFound.backHome}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={buildLocalePath("/charts", locale)}>{notFound.browseCharts}</Link>
        </Button>
      </RevealItem>
    </main>
  );
}
