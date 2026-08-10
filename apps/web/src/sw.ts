/**
 * Service worker source for the AstroDX archive.
 *
 * Compiled by `@serwist/cli` (`serwist build`) AFTER `next build`: the CLI globs
 * the static export in `out/`, injects a precache manifest at `self.__SW_MANIFEST`,
 * and bundles this file with esbuild into `out/sw.js`. See `serwist.config.js`.
 *
 * Design note — the export is ~1.4 GB (3k+ cover dirs, one HTML page per chart),
 * so we precache ONLY the app shell (hashed `_next/static` assets + the offline
 * page + icons). Everything heavy is served by the runtime strategies below and
 * cached on demand, never up front.
 */
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  type PrecacheEntry,
  type RuntimeCaching,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from "serwist";

import { CHART_MEDIA_HOST } from "./lib/chart-media";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Matches `injectionPoint` in serwist.config.js.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// The remote mirror that serves cover art / media when the build runs in
// `ASTRODX_COVERS=remote` mode. The shared hostname also drives the root
// preconnect so the two consumers cannot drift during another media migration.
// Third-party backends that must always be live (pageview counter, comments).
const LIVE_HOSTS = ["bsz.saop.cc", "artalk.saop.cc"];
const ONE_DAY = 60 * 60 * 24;

const runtimeCaching: RuntimeCaching[] = [
  // 1. Next.js build output — content-hashed, immutable. Cache forever.
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "next-static",
      plugins: [
        new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: ONE_DAY * 365, maxAgeFrom: "last-used" }),
      ],
    }),
  },
  // 2. RSC flight payloads. Every in-site navigation is a client-side one, so
  //    the page a user actually reads arrives as `.../__next.*.txt?_rsc=...` —
  //    a plain `fetch` whose `destination` is "" and whose mode is "cors", not
  //    "navigate". None of the other rules can see it, which used to mean the
  //    offline page's promise that "cached pages are still available" was false
  //    for everything except full hard loads. SWR keeps navigation instant on a
  //    repeat visit and still refreshes in the background.
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && (url.pathname.includes("__next.") || url.searchParams.has("_rsc")),
    handler: new StaleWhileRevalidate({
      cacheName: "rsc-payloads",
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 400,
          maxAgeSeconds: ONE_DAY * 30,
          maxAgeFrom: "last-used",
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // 3. Build-time JSON manifests (`/charts/search-index.json`, `specs.json`,
  //    `slugs.json`, `/music/playlists.json`). Same blind spot as the RSC
  //    payloads: no `destination`, not under `/_next/static/`, and served with
  //    `max-age=600`, so they were re-downloaded every ten minutes.
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith(".json"),
    handler: new StaleWhileRevalidate({
      cacheName: "catalog-manifests",
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 32,
          maxAgeSeconds: ONE_DAY * 7,
          maxAgeFrom: "last-used",
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // 4. Cover art — the archive's heaviest repeat traffic. Served either locally
  //    (`/covers/...`) or from the remote mirror. Cache aggressively but bound it
  //    so a heavy browsing session can't blow past the storage quota.
  //
  //    The same cover URL is consumed in BOTH request modes: plain <img> tags
  //    and MediaSession artwork fetch in no-cors, the chart-preview canvas and
  //    GIF export with crossOrigin="anonymous". A cached opaque (no-cors)
  //    response served to a CORS-mode request is rejected by the browser as a
  //    CORS failure, so the first no-cors consumer used to poison every later
  //    canvas load. Always fetching in CORS mode (the mirror sends
  //    Access-Control-Allow-Origin + Vary: Origin) yields one cached response
  //    every consumer can use.
  {
    matcher: ({ url, request, sameOrigin }) =>
      request.destination === "image" &&
      ((sameOrigin && url.pathname.startsWith("/covers/")) ||
        url.hostname === CHART_MEDIA_HOST),
    handler: new CacheFirst({
      cacheName: "cover-images",
      plugins: [
        {
          // A no-cors Request cannot be re-initialized directly (the spec
          // forbids it), so build a fresh CORS request for the same URL.
          requestWillFetch: async ({ request }) =>
            new Request(request.url, { mode: "cors", credentials: "omit" }),
        },
        // CORS-mode fetches always expose the real status; never cache errors.
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 600,
          maxAgeSeconds: ONE_DAY * 30,
          maxAgeFrom: "last-used",
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // 5. Other same-origin images (favicons, brand icons, OG image, inline SVGs).
  {
    matcher: ({ request, sameOrigin }) => sameOrigin && request.destination === "image",
    handler: new StaleWhileRevalidate({
      cacheName: "static-images",
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: ONE_DAY * 30 }),
      ],
    }),
  },
  // 6. Fonts. @fontsource ships them under /_next/static/media (rule 1 already
  //    covers those); this catches any other font request.
  {
    matcher: ({ request }) => request.destination === "font",
    handler: new CacheFirst({
      cacheName: "fonts",
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: ONE_DAY * 365 }),
      ],
    }),
  },
  // 7. Live third-party data (pageview counter, comments) — never cache.
  {
    matcher: ({ url }) => LIVE_HOSTS.includes(url.hostname),
    handler: new NetworkOnly(),
  },
  // 8. HTML navigations — fresh content when online, fall back to cache, then to
  //    the precached offline page (configured via `fallbacks` below). The entry
  //    budget is sized for a real browsing session (a visitor easily opens more
  //    than 64 charts), and eviction is by last use so the pages someone keeps
  //    coming back to are the ones that survive.
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 3,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 200,
          maxAgeSeconds: ONE_DAY * 30,
          maxAgeFrom: "last-used",
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
];

// Earlier deployments cached opaque cover responses (see runtime rule 2). They
// would keep failing CORS-mode consumers for up to 30 days, so drop them once
// on activation; the CORS-mode strategy refills the cache as covers are viewed.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open("cover-images");
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response?.type === "opaque") {
          await cache.delete(request);
        }
      }
    })().catch(() => {
      // A failed sweep must never block SW activation.
    })
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Deliberately NOT skipWaiting. Activating immediately sweeps the previous
  // build's precached `_next/static` chunks out from under every open tab, so a
  // long-lived tab that lazy-loads anything afterwards throws ChunkLoadError.
  // The new worker now waits; ServiceWorkerRegistrar surfaces a "reload to
  // update" prompt and posts SKIP_WAITING when the user accepts (Serwist
  // installs that message handler for us whenever skipWaiting is false).
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        // Precached by serwist.config.js's globPatterns.
        url: "/offline.html",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
