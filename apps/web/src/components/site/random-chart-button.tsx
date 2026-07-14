"use client";

import { DicesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { buildLocalePath, type Locale } from "@/lib/i18n";
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
};

/** Jumps to a random chart detail page (slug list fetched on first click). */
export function RandomChartButton({
  locale,
  label,
  iconOnly = false,
  className,
}: RandomChartButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const handleClick = React.useCallback(async () => {
    setBusy(true);
    try {
      const slugs = await loadSlugs();
      if (slugs.length === 0) {
        return;
      }
      const slug = slugs[Math.floor(Math.random() * slugs.length)];
      router.push(buildLocalePath(`/charts/${encodeURIComponent(slug)}`, locale));
    } catch {
      // Fetch failed (offline?) — quietly give up; the button stays usable.
    } finally {
      setBusy(false);
    }
  }, [locale, router]);

  if (iconOnly) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleClick}
        disabled={busy}
        aria-label={label}
        title={label}
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
      onClick={handleClick}
      disabled={busy}
      className={className}
    >
      <DicesIcon data-icon="inline-start" aria-hidden="true" className={cn(busy && "animate-spin")} />
      {label}
    </Button>
  );
}
