"use client";

import { motion, revealTransition } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Which page shape to stand in for. A route group's `loading.tsx` covers every
 * descendant segment, so each shape gets its own boundary (see the
 * `loading.tsx` files) rather than one grid placeholder standing in for text
 * pages and chart details too.
 */
type RouteLoadingVariant = "catalog" | "detail" | "prose";

const CONTAINER_WIDTH: Record<RouteLoadingVariant, string> = {
  catalog: "max-w-7xl",
  detail: "max-w-6xl",
  prose: "max-w-3xl",
};

/**
 * Route-level loading skeleton shown during client-side navigations while the
 * next page's payload streams in. Mirrors the target layout's container width,
 * paddings and gaps so the handoff to real content doesn't shift things around.
 * Pure placeholder UI, so the cascade's initial opacity never hides real content.
 */
export function RouteLoadingSkeleton({
  label,
  variant = "catalog",
}: {
  label: string;
  variant?: RouteLoadingVariant;
}) {
  return (
    <main
      id="main-content"
      aria-busy="true"
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-8 md:px-6 md:py-10 ${CONTAINER_WIDTH[variant]}`}
    >
      <span role="status" className="sr-only">
        {label}
      </span>
      {variant === "catalog" ? <CatalogSkeleton /> : null}
      {variant === "detail" ? <DetailSkeleton /> : null}
      {variant === "prose" ? <ProseSkeleton /> : null}
    </main>
  );
}

/** /charts and /versions: heading block, filter box, toolbar, then the card grid. */
function CatalogSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      {/* The filter box + random button row CatalogBrowser renders above the grid. */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 min-w-0 flex-1 rounded-lg" />
        <Skeleton className="size-10 shrink-0 rounded-lg" />
      </div>
      <Skeleton className="h-5 w-24" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-7 w-16 rounded-lg" />
        <Skeleton className="h-4 w-40 max-w-[45%]" />
      </div>
      <CardGrid />
    </div>
  );
}

/** Matches the browse grid's column counts so cards don't reflow on handoff. */
function CardGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: 12 }, (_, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0.6, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...revealTransition, delay: index * 0.04 }}
          className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/60 p-3"
        >
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </motion.div>
      ))}
    </div>
  );
}

/** /charts/[slug]: breadcrumb, cover + title hero, then the two info columns. */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <Skeleton className="h-4 w-48 max-w-full" />
      <div className="overflow-hidden rounded-3xl border border-border/60">
        <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Skeleton className="mx-auto aspect-square w-full max-w-[260px] rounded-2xl lg:mx-0" />
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-3/4 max-w-md md:h-12" />
              <Skeleton className="h-6 w-1/2 max-w-xs" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-6 w-16 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-4 w-full max-w-2xl" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 w-32 rounded-lg" />
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_320px]">
        <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/60 p-6">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/60 p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Home and the narrow text pages (about, donate, links…): heading + paragraphs. */
function ProseSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0.6, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...revealTransition, delay: index * 0.08 }}
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-6 w-40 max-w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </motion.div>
      ))}
    </div>
  );
}
