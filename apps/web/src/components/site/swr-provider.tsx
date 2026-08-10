"use client";

import { SWRConfig } from "swr";

import { jsonFetcher } from "@/lib/swr-fetcher";

/**
 * App-wide SWR defaults. Lives in a client module so the fetcher function never
 * has to cross the server→client boundary (SWRConfig's `value` carries
 * functions, which are not serializable as RSC props).
 *
 * Conservative defaults for a mostly-static catalog site: no focus revalidation
 * by default (chart text never changes), a couple of retries on transient
 * errors. Hooks that genuinely want live data (server status) opt back into
 * focus/interval revalidation locally.
 *
 * Reconnect revalidation IS on: every fetch behind these defaults is a static
 * per-deploy JSON manifest, and after three failed retries offline the data
 * would otherwise stay missing until a full reload — the search index, the
 * playlist manifest and the chart preview all silently stop working. The one
 * hook that must not re-run on reconnect is the pageview recorder (its fetcher
 * increments a counter); it opts out at its own call site.
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: jsonFetcher,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        errorRetryCount: 3,
      }}
    >
      {children}
    </SWRConfig>
  );
}
