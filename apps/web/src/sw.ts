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

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Matches `injectionPoint` in serwist.config.js.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// The remote mirror that serves cover art / media when the build runs in
// `ASTRODX_COVERS=remote` mode (see root-layout-shell COVER_HOST).
const COVER_HOST = "adxcs.saop.cc";
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
  // 2. Cover art — the archive's heaviest repeat traffic. Served either locally
  //    (`/covers/...`) or from the remote mirror. Cache aggressively but bound it
  //    so a heavy browsing session can't blow past the storage quota.
  {
    matcher: ({ url, request, sameOrigin }) =>
      request.destination === "image" &&
      ((sameOrigin && url.pathname.startsWith("/covers/")) || url.hostname === COVER_HOST),
    handler: new CacheFirst({
      cacheName: "cover-images",
      plugins: [
        // Opaque cross-origin responses report status 0 — allow them through.
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 600,
          maxAgeSeconds: ONE_DAY * 30,
          maxAgeFrom: "last-used",
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // 3. Other same-origin images (favicons, brand icons, OG image, inline SVGs).
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
  // 4. Fonts. @fontsource ships them under /_next/static/media (rule 1 already
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
  // 5. Live third-party data (pageview counter, comments) — never cache.
  {
    matcher: ({ url }) => LIVE_HOSTS.includes(url.hostname),
    handler: new NetworkOnly(),
  },
  // 6. HTML navigations — fresh content when online, fall back to cache, then to
  //    the precached offline page (configured via `fallbacks` below).
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 5,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: ONE_DAY * 7 }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
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
