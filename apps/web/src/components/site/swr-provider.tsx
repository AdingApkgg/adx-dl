"use client";

import { SWRConfig } from "swr";

import { jsonFetcher } from "@/lib/swr-fetcher";

/**
 * App-wide SWR defaults. Lives in a client module so the fetcher function never
 * has to cross the server→client boundary (SWRConfig's `value` carries
 * functions, which are not serializable as RSC props).
 *
 * Conservative defaults for a mostly-static catalog site: no focus revalidation
 * by default (page-view POSTs must not double-count, chart text never changes),
 * a couple of retries on transient errors. Hooks that genuinely want live data
 * (server status) opt back into focus/interval revalidation locally.
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: jsonFetcher,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        errorRetryCount: 3,
      }}
    >
      {children}
    </SWRConfig>
  );
}
