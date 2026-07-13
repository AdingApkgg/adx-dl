"use client";

import { useInView, useReducedMotion } from "framer-motion";
import Link from "next/link";
import * as React from "react";

import { RevealItem, motion } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  buildLocalePath,
  getDictionary,
  isSupportedLocale,
  type Locale,
} from "@/lib/i18n";

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
  const [locale, setLocale] = React.useState<Locale>("zh");
  const reducedMotion = useReducedMotion();
  const glyphsRef = React.useRef<HTMLDivElement>(null);
  const glyphsInView = useInView(glyphsRef);
  // MotionConfig reducedMotion="user" does not stop infinite repeat loops, so
  // the idle bob is gated by hand — and paused off-screen / pre-mount.
  const bobbing = !reducedMotion && glyphsInView;

  React.useEffect(() => {
    const [firstSegment] = window.location.pathname.split("/").filter(Boolean);
    if (firstSegment && isSupportedLocale(firstSegment)) {
      // Intentional one-time sync from the URL (an external system) after
      // mount — the static 404.html is one page for all locales, so the SSR
      // markup must stay zh and re-render only on the client.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLocale(firstSegment);
    }
  }, []);

  const notFound = getDictionary(locale).notFound;

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
