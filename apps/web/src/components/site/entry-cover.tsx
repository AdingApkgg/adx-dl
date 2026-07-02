"use client";

import * as React from "react";

import {
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
    const imgClassName =
      "absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105";
    const loading = priority ? ("eager" as const) : ("lazy" as const);
    const fetchPriority = priority ? ("high" as const) : ("auto" as const);
    return (
      <div className={cn("relative overflow-hidden rounded-xl", className)}>
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
