"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { EyeIcon } from "lucide-react";

import { defaultLocale, getDictionary, isSupportedLocale, locales } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Self-hosted busuanzi-compatible counter. `POST /api` increments and returns
// the totals; the visited page is identified by the `x-bsz-referer` header and
// the visitor by a first-party cookie (hence `credentials: "include"`).
const BSZ_ENDPOINT = "https://bsz.saop.cc/api";

type PageViews = {
  sitePv: number;
  siteUv: number;
  pagePv: number;
};

type BszResponse = {
  success?: boolean;
  data?: { site_pv?: number; site_uv?: number; page_pv?: number };
};

// `undefined` = no response yet (loading), `null` = the backend answered with a
// failure (recordView swallows errors), a value = live totals.
const PageViewsContext = React.createContext<PageViews | null | undefined>(undefined);

async function recordView(referer: string): Promise<PageViews | null> {
  try {
    const res = await fetch(BSZ_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "x-bsz-referer": referer },
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as BszResponse;
    if (!body.success || !body.data) {
      return null;
    }
    const { site_pv = 0, site_uv = 0, page_pv = 0 } = body.data;
    return { sitePv: site_pv, siteUv: site_uv, pagePv: page_pv };
  } catch {
    return null;
  }
}

// Strip a leading non-default locale prefix (/en, /ja) so all localized variants
// of a page share one busuanzi page key — keeping per-page counts aggregated
// across locales, exactly like the (locale-independent) comment thread. Query
// and hash are dropped so cache-busting params don't fragment the key.
function canonicalReferer(pathname: string): string {
  const segments = pathname.split("/");
  const maybeLocale = segments[1];
  if (
    maybeLocale &&
    maybeLocale !== defaultLocale &&
    (locales as readonly string[]).includes(maybeLocale)
  ) {
    segments.splice(1, 1);
  }
  return `${window.location.origin}${segments.join("/") || "/"}`;
}

/**
 * Records one page view per client navigation and shares the resulting totals
 * with every consumer (footer site totals, per-chart count) so a single POST
 * backs them all instead of each widget counting independently.
 */
export function PageViewsProvider({ children }: { children: React.ReactNode }) {
  // usePathname re-renders on navigation; we derive the canonical referer key
  // from it (the SWR key IS the thing that determines the response, so localized
  // variants share one cache entry). window is absent during the static
  // prerender, so the key is null there — SWR skips fetching and the first
  // client render matches the server markup.
  const pathname = usePathname();
  const refererKey = typeof window === "undefined" ? null : canonicalReferer(pathname);

  const { data } = useSWR<PageViews | null>(refererKey, recordView, {
    // Keep the previous totals visible while the next page's numbers load to
    // avoid a flash of empty counters in the footer on every navigation.
    keepPreviousData: true,
  });

  return <PageViewsContext.Provider value={data}>{children}</PageViewsContext.Provider>;
}

function usePageViews(): PageViews | null | undefined {
  return React.useContext(PageViewsContext);
}

// The counter widgets receive their visible labels as props from server
// parents, so resolve the locale for the failure fallback from the URL the
// same way the provider does.
function usePageViewsDictionary() {
  const pathname = usePathname();
  const maybeLocale = pathname.split("/")[1];
  const locale = maybeLocale && isSupportedLocale(maybeLocale) ? maybeLocale : defaultLocale;
  return getDictionary(locale).pageViews;
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

const LOADING_PLACEHOLDER = "···";
const UNAVAILABLE_PLACEHOLDER = "—";

/**
 * One counter value in all three states: the loading ellipsis, the formatted
 * total, or a quiet em-dash once the backend has failed. The dash is hidden
 * from the aria-live announcement in favor of a localized description.
 */
function CountValue({
  views,
  field,
  unavailableLabel,
}: {
  views: PageViews | null | undefined;
  field: keyof PageViews;
  unavailableLabel: string;
}) {
  if (views === null) {
    return (
      <span className="font-medium">
        <span aria-hidden="true">{UNAVAILABLE_PLACEHOLDER}</span>
        <span className="sr-only">{unavailableLabel}</span>
      </span>
    );
  }
  return (
    <span className="font-medium">{views ? formatCount(views[field]) : LOADING_PLACEHOLDER}</span>
  );
}

/** Site-wide PV/UV totals, rendered in the footer on every page. */
export function SitePageViews({
  siteViewsLabel,
  siteVisitorsLabel,
}: {
  siteViewsLabel: string;
  siteVisitorsLabel: string;
}) {
  const views = usePageViews();
  const { unavailable } = usePageViewsDictionary();

  return (
    <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
      {siteViewsLabel}{" "}
      <CountValue views={views} field="sitePv" unavailableLabel={unavailable} />
      <span aria-hidden="true" className="px-2">
        ·
      </span>
      {siteVisitorsLabel}{" "}
      <CountValue views={views} field="siteUv" unavailableLabel={unavailable} />
    </p>
  );
}

/** Per-page view count, rendered on chart detail pages. */
export function ChartPageViews({ label, className }: { label: string; className?: string }) {
  const views = usePageViews();
  const { unavailable } = usePageViewsDictionary();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums",
        className
      )}
      aria-live="polite"
    >
      <EyeIcon className="size-4" aria-hidden="true" />
      {label}{" "}
      <CountValue views={views} field="pagePv" unavailableLabel={unavailable} />
    </span>
  );
}
