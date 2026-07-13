"use client";

import * as React from "react";

import {
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Cross-document View Transition morph (Chromium progressive enhancement via
// @view-transition in globals.css): a clicked card cover pairs with the chart
// detail hero, which statically carries viewTransitionName:"chart-cover". Grid
// cards must NEVER carry the name statically — the browser skips the whole
// transition if two elements share it — so we tag only the clicked cover, at
// click time, and keep a module-level registry to guarantee uniqueness.
const COVER_VIEW_TRANSITION_NAME = "chart-cover";

// The cover we tagged for the outgoing navigation (module state survives
// bfcache, so a back-navigation can find and retract the stale tag).
let taggedCover: HTMLElement | null = null;
// Elements whose static inline "chart-cover" we retracted at click time (the
// detail hero, when clicking a related-charts card) — restored on pageshow so
// a bfcache-restored page keeps its hero morphable.
let suppressedCovers: HTMLElement[] = [];

function tagCoverForNavigation(cover: HTMLElement) {
  // Retract the name from every other inline holder first (a previously
  // clicked card, or the detail hero's static tag) so exactly one element
  // carries it when the old-page snapshot is captured.
  for (const el of document.querySelectorAll<HTMLElement>(
    `[style*="${COVER_VIEW_TRANSITION_NAME}"]`
  )) {
    if (el !== cover && el.style.viewTransitionName === COVER_VIEW_TRANSITION_NAME) {
      el.style.viewTransitionName = "";
      if (el !== taggedCover && !suppressedCovers.includes(el)) suppressedCovers.push(el);
    }
  }
  cover.style.viewTransitionName = COVER_VIEW_TRANSITION_NAME;
  taggedCover = cover;
}

function resetCoverTagsOnPageshow() {
  // bfcache restores the tagged DOM as-is; clear the stale click tag so a
  // later navigation never morphs from (or duplicates with) an old card, and
  // give retracted static holders their name back.
  if (taggedCover) {
    taggedCover.style.viewTransitionName = "";
    taggedCover = null;
  }
  for (const el of suppressedCovers) {
    el.style.viewTransitionName = COVER_VIEW_TRANSITION_NAME;
  }
  suppressedCovers = [];
}

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", resetCoverTagsOnPageshow);
}

type EntryCoverProps = {
  entry: CatalogEntry;
  locale: "zh" | "en" | "ja";
  className?: string;
  /** Eagerly load above-the-fold covers (LCP). Next 16: use loading/fetchPriority, not the deprecated `priority` prop. */
  priority?: boolean;
  sizes?: string;
};

export function EntryCover({
  entry,
  locale,
  className,
  priority = false,
  sizes = "(max-width: 768px) 100vw, 512px",
}: EntryCoverProps) {
  const title = formatEntryTitle(entry, locale);
  const cover = getDictionary(locale).cover;
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    // Covers rendered inside a card link arm the shared-element morph on
    // click; standalone covers (the detail hero) have no anchor ancestor and
    // bail out. One plain listener per card — no motion subscriptions.
    const anchor = root?.closest("a[href]");
    if (!root || !anchor) return;
    const arm = (event: Event) => {
      const { button, metaKey, ctrlKey, shiftKey, altKey } = event as MouseEvent;
      // Modifier/aux clicks open a new tab and never navigate this document —
      // tagging would leave a stale name behind.
      if (event.defaultPrevented || button !== 0 || metaKey || ctrlKey || shiftKey || altKey) {
        return;
      }
      tagCoverForNavigation(root);
    };
    anchor.addEventListener("click", arm);
    return () => anchor.removeEventListener("click", arm);
  }, []);
  // Local AVIF/WebP (smallest) are build artifacts emitted by the pipeline; a
  // fresh worktree or any dev checkout that hasn't generated them serves 404s
  // for /covers/*, and <picture> does NOT fall back from a matched-but-failed
  // <source> to the <img src>. So we walk a fallback ladder on error:
  //   optimized local <picture> → the remote original → styled placeholder.
  const avif = entry.media.cover_avif;
  const webp = entry.media.cover_webp;
  const original = entry.media.cover_url;
  const hasOptimized = Boolean(avif || webp);
  const [stage, setStage] = React.useState<"optimized" | "original" | "failed">(
    hasOptimized ? "optimized" : original ? "original" : "failed"
  );

  const handleError = () =>
    setStage((current) => (current === "optimized" && original ? "original" : "failed"));

  if (stage !== "failed") {
    // The fill styling mirrors what next/image fill emitted (the site is a
    // static export, so Image was unoptimized and bought us nothing over <img>).
    const alt = cover.alt(title);
    // Hover zoom rides the site's shared ease-out curve (EASE_OUT in
    // components/motion) — transform-only, pure CSS, no per-card JS.
    const imgClassName =
      "absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06]";
    const loading = priority ? ("eager" as const) : ("lazy" as const);
    const fetchPriority = priority ? ("high" as const) : ("auto" as const);
    return (
      <div ref={rootRef} className={cn("relative overflow-hidden rounded-xl", className)}>
        {stage === "optimized" ? (
          <picture>
            {avif ? <source srcSet={avif} type="image/avif" /> : null}
            {webp ? <source srcSet={webp} type="image/webp" /> : null}
            {/* src is the remote original: the fallback for browsers with no
                AVIF/WebP support. When a chosen <source> 404s instead, onError
                drops to the plain <img src={original}> branch below. */}
            <img
              src={original || avif || webp}
              alt={alt}
              sizes={sizes}
              className={imgClassName}
              loading={loading}
              fetchPriority={fetchPriority}
              decoding="async"
              onError={handleError}
            />
          </picture>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- static export: next/image is unoptimized here
          <img
            src={original}
            alt={alt}
            sizes={sizes}
            className={imgClassName}
            loading={loading}
            fetchPriority={fetchPriority}
            decoding="async"
            onError={handleError}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label={cover.placeholder}
      className={cn(
        "flex h-full w-full items-end rounded-xl bg-linear-to-br from-slate-950 via-slate-800 to-blue-700 p-4 text-white",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.24em] text-white/70">
          {formatEntrySubcategory(entry)}
        </span>
        <span className="line-clamp-2 text-lg font-semibold">{title}</span>
      </div>
    </div>
  );
}
