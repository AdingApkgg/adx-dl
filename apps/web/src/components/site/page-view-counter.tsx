"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { EyeIcon } from "lucide-react";

import { defaultLocale, locales } from "@/lib/i18n";
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

const PageViewsContext = React.createContext<PageViews | null>(null);

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
function canonicalReferer(): string {
  const { origin, pathname } = window.location;
  const segments = pathname.split("/");
  const maybeLocale = segments[1];
  if (
    maybeLocale &&
    maybeLocale !== defaultLocale &&
    (locales as readonly string[]).includes(maybeLocale)
  ) {
    segments.splice(1, 1);
  }
  return `${origin}${segments.join("/") || "/"}`;
}

/**
 * Records one page view per client navigation and shares the resulting totals
 * with every consumer (footer site totals, per-chart count) so a single POST
 * backs them all instead of each widget counting independently.
 */
export function PageViewsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [views, setViews] = React.useState<PageViews | null>(null);

  React.useEffect(() => {
    let active = true;
    // Keep the previous totals visible while the next page's numbers load to
    // avoid a flash of empty counters in the footer on every navigation.
    recordView(canonicalReferer()).then((next) => {
      if (active && next) {
        setViews(next);
      }
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  return <PageViewsContext.Provider value={views}>{children}</PageViewsContext.Provider>;
}

function usePageViews(): PageViews | null {
  return React.useContext(PageViewsContext);
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

const LOADING_PLACEHOLDER = "···";

/** Site-wide PV/UV totals, rendered in the footer on every page. */
export function SitePageViews({
  siteViewsLabel,
  siteVisitorsLabel,
}: {
  siteViewsLabel: string;
  siteVisitorsLabel: string;
}) {
  const views = usePageViews();

  return (
    <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
      {siteViewsLabel}{" "}
      <span className="font-medium">{views ? formatCount(views.sitePv) : LOADING_PLACEHOLDER}</span>
      <span aria-hidden="true" className="px-2">
        ·
      </span>
      {siteVisitorsLabel}{" "}
      <span className="font-medium">{views ? formatCount(views.siteUv) : LOADING_PLACEHOLDER}</span>
    </p>
  );
}

/** Per-page view count, rendered on chart detail pages. */
export function ChartPageViews({ label, className }: { label: string; className?: string }) {
  const views = usePageViews();

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
      <span className="font-medium">{views ? formatCount(views.pagePv) : LOADING_PLACEHOLDER}</span>
    </span>
  );
}
