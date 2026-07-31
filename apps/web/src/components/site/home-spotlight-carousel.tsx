"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import { useInView } from "framer-motion";

import { AnimatePresence, EASE_OUT, motion, useReducedMotion } from "@/components/motion";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { EntryCover } from "@/components/site/entry-cover";
import { GenreBadge } from "@/components/site/genre-badge";
import styles from "@/components/site/home-page.module.css";
import { VersionBadge } from "@/components/site/version-badge";
import type { CatalogEntry } from "@/lib/catalog";
import {
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { cn } from "@/lib/utils";

const SPOTLIGHT_LIMIT = 3;
const AUTOPLAY_DELAY_MS = 6800;

export function wrapCarouselIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

type HomeSpotlightCarouselProps = {
  entries: CatalogEntry[];
  locale: Locale;
};

export function HomeSpotlightCarousel({ entries, locale }: HomeSpotlightCarouselProps) {
  const items = React.useMemo(() => entries.slice(0, SPOTLIGHT_LIMIT), [entries]);
  const dictionary = getDictionary(locale);
  const home = dictionary.home;
  const reducedMotion = useReducedMotion();
  const rootRef = React.useRef<HTMLElement>(null);
  const inView = useInView(rootRef, { amount: 0.35 });
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [hovered, setHovered] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [userPaused, setUserPaused] = React.useState(false);
  const [tabVisible, setTabVisible] = React.useState(true);
  const [announcement, setAnnouncement] = React.useState("");

  const safeIndex = wrapCarouselIndex(activeIndex, items.length);
  const currentEntry = items[safeIndex] ?? null;

  React.useEffect(() => {
    const updateVisibility = () => setTabVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  // Load the two follow-up covers after hydration so a transition never reveals
  // an empty frame. The first cover remains the only LCP/preload candidate.
  React.useEffect(() => {
    for (const entry of items.slice(1)) {
      if (!entry.media.cover_url) continue;
      const image = new window.Image();
      image.decoding = "async";
      image.src = entry.media.cover_url;
    }
  }, [items]);

  const autoplayActive =
    items.length > 1 &&
    !reducedMotion &&
    !userPaused &&
    !hovered &&
    !focusWithin &&
    inView &&
    tabVisible;

  React.useEffect(() => {
    if (!autoplayActive) return;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => wrapCarouselIndex(index + 1, items.length));
    }, AUTOPLAY_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplayActive, items.length]);

  const selectSlide = React.useCallback(
    (index: number) => {
      const nextIndex = wrapCarouselIndex(index, items.length);
      const nextEntry = items[nextIndex];
      if (!nextEntry) return;
      setActiveIndex(nextIndex);
      setAnnouncement(
        `${nextIndex + 1} / ${items.length} · ${formatEntryTitle(nextEntry, locale)}`
      );
    },
    [items, locale]
  );

  const handleBlur = (event: React.FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextTarget)) setFocusWithin(false);
  };

  if (!currentEntry) return null;

  const currentTitle = formatEntryTitle(currentEntry, locale);
  const currentHref = buildLocalePath(`/charts/${entrySlug(currentEntry)}`, locale);

  return (
    <article
      ref={rootRef}
      className={styles.spotlightCarousel}
      role="region"
      aria-roledescription={home.spotlightCarouselRole}
      aria-label={home.spotlightLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={handleBlur}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={currentEntry.id}
          className={styles.spotlightSlide}
          role="group"
          aria-roledescription={home.spotlightSlideRole}
          aria-label={`${safeIndex + 1} / ${items.length}: ${currentTitle}`}
          initial={reducedMotion ? false : { opacity: 0, scale: 0.975 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
          transition={{ duration: reducedMotion ? 0 : 0.24, ease: EASE_OUT }}
        >
          <Link
            href={currentHref}
            className={cn("group", styles.spotlightCard)}
            aria-label={`${home.openDetail}: ${currentTitle}`}
          >
            <span className={styles.spotlightCoverFrame}>
              <EntryCover
                entry={currentEntry}
                locale={locale}
                fit="contain"
                priority={safeIndex === 0}
                sizes="(max-width: 760px) calc(100vw - 5rem), (max-width: 1100px) 384px, 384px"
                className={styles.spotlightCover}
              />
              <span className={styles.spotlightBadge}>
                <SparklesIcon aria-hidden="true" />
                {home.spotlightLabel}
              </span>
            </span>
            <span className={styles.spotlightCardBody}>
              <span className={styles.spotlightCardCopy}>
                <strong className={styles.spotlightCardTitle}>{currentTitle}</strong>
                <span className={styles.spotlightCardArtist}>
                  {formatEntryArtist(currentEntry, locale)}
                </span>
              </span>
              <span className={styles.spotlightCardBadges}>
                <VersionBadge
                  version={currentEntry.version}
                  label={formatEntrySubcategory(currentEntry)}
                  className="h-6"
                />
                <CabinetBadge cabinet={currentEntry.cabinet} className="h-5" />
                <GenreBadge entry={currentEntry} locale={locale} />
              </span>
              {currentEntry.difficulties.length > 0 ? (
                <span className={styles.spotlightDifficulties}>
                  {currentEntry.difficulties.slice(0, 5).map((difficulty) => (
                    <DifficultyPill
                      key={`${currentEntry.id}-${difficulty.slot}`}
                      difficulty={difficulty}
                    />
                  ))}
                </span>
              ) : null}
            </span>
          </Link>
        </motion.div>
      </AnimatePresence>

      {items.length > 1 ? (
        <div className={styles.spotlightControls} role="group" aria-label={home.spotlightLabel}>
          <button
            type="button"
            className={styles.spotlightControl}
            aria-label={home.spotlightPrevious}
            onClick={() => selectSlide(safeIndex - 1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </button>
          <div className={styles.spotlightDots}>
            {items.map((entry, index) => {
              const title = formatEntryTitle(entry, locale);
              const active = index === safeIndex;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.spotlightDot}
                  data-spotlight-picker="true"
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "true" : undefined}
                  aria-label={`${index + 1} / ${items.length}: ${title}`}
                  onClick={() => selectSlide(index)}
                />
              );
            })}
          </div>
          {!reducedMotion ? (
            <button
              type="button"
              className={styles.spotlightPlayback}
              aria-label={userPaused ? home.spotlightResume : home.spotlightPause}
              onClick={() => setUserPaused((paused) => !paused)}
            >
              {userPaused ? (
                <PlayIcon aria-hidden="true" />
              ) : (
                <PauseIcon aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.spotlightControl}
            aria-label={home.spotlightNext}
            onClick={() => selectSlide(safeIndex + 1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </article>
  );
}
