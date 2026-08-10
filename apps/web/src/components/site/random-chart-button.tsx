"use client";

import { DicesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { useOnlineStatus } from "@/lib/use-online-status";
import { cn } from "@/lib/utils";

// The slug list is static per deploy — fetch it once per session and share it
// across every random button on the page.
let slugsPromise: Promise<string[]> | null = null;

function loadSlugs(): Promise<string[]> {
  if (!slugsPromise) {
    slugsPromise = fetch("/charts/slugs.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`slugs.json responded ${response.status}`);
        }
        return response.json() as Promise<string[]>;
      })
      .catch((error) => {
        // Evict so a later click can retry after a transient failure.
        slugsPromise = null;
        throw error;
      });
  }
  return slugsPromise;
}

type RandomChartButtonProps = {
  locale: Locale;
  label: string;
  /** Icon-only compact form for toolbars; the label becomes the aria-label. */
  iconOnly?: boolean;
  className?: string;
  /**
   * Slugs to draw from. Passed by the catalog browser so "random" respects the
   * filters the user is looking at; omitted elsewhere, which draws from the
   * whole library via `slugs.json`. An *empty* pool is not the same as an
   * absent one — it means the current filters match nothing, and jumping to
   * some unrelated chart from the whole library would ignore them entirely.
   */
  pool?: readonly string[];
};

/**
 * `pool` short-circuits the network entirely, which is also what makes the
 * button work offline inside an already-loaded catalog page.
 */
export function useRandomChartNavigation(locale: Locale, pool?: readonly string[]) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const navigateToRandomChart = React.useCallback(async () => {
    setBusy(true);
    try {
      const slugs = pool ?? (await loadSlugs());
      if (slugs.length === 0) {
        return;
      }
      const slug = slugs[Math.floor(Math.random() * slugs.length)];
      router.push(buildLocalePath(`/charts/${encodeURIComponent(slug)}`, locale));
    } catch {
      // The only failure mode is slugs.json not arriving, which in practice
      // means offline — and the button is already disabled in that state, so
      // there is nothing further to tell the user here.
    } finally {
      setBusy(false);
    }
  }, [locale, pool, router]);

  return { busy, navigateToRandomChart };
}

/** Jumps to a random chart detail page (slug list fetched on first click). */
export function RandomChartButton({
  locale,
  label,
  iconOnly = false,
  className,
  pool,
}: RandomChartButtonProps) {
  const { busy, navigateToRandomChart } = useRandomChartNavigation(locale, pool);
  const online = useOnlineStatus();
  // With a pool in hand the navigation is purely local, so only the
  // slugs.json path is gated on connectivity. Being explicit beats the old
  // behaviour of accepting the click and then doing nothing — which is also
  // why an empty pool disables the button instead of silently no-oping.
  const blockedByNetwork = !pool && !online;
  const unavailable = pool ? pool.length === 0 : !online;
  // Only the network case has something to explain; an empty pool is already
  // explained by the empty result grid the button sits next to.
  const hint = blockedByNetwork ? getDictionary(locale).connection.offline : label;

  if (iconOnly) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={navigateToRandomChart}
        disabled={busy || unavailable}
        aria-label={label}
        title={hint}
        className={cn("h-10 w-10 shrink-0 border-border bg-card shadow-sm", className)}
      >
        <DicesIcon className={cn(busy && "animate-spin")} aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={navigateToRandomChart}
      disabled={busy || unavailable}
      title={blockedByNetwork ? hint : undefined}
      className={className}
    >
      <DicesIcon data-icon="inline-start" aria-hidden="true" className={cn(busy && "animate-spin")} />
      {label}
    </Button>
  );
}
