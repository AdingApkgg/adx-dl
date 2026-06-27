// @ts-check
/**
 * `@serwist/cli` config — consumed by `serwist build` (see the `build` script),
 * which runs AFTER `next build`. It globs the static export in `out/`, computes a
 * precache manifest, injects it into `src/sw.ts` at `injectionPoint`, and esbuild-
 * bundles the result to `out/sw.js`.
 *
 * KEEP THE PRECACHE TINY. The export is ~1.4 GB (3k+ cover dirs, one HTML page per
 * chart). Only the app shell is precached here; covers/charts/media are handled by
 * runtime caching in `src/sw.ts` and fetched on demand.
 */

/** @type {import("@serwist/build").InjectManifestOptions} */
const config = {
  swSrc: "src/sw.ts",
  swDest: "out/sw.js",
  globDirectory: "out",
  // App shell only.
  globPatterns: [
    "_next/static/**/*.{js,css}",
    "offline.html",
    "site.webmanifest",
    "favicon.ico",
    "favicon-32x32.png",
    "icon-192.png",
    "icon-512.png",
    "apple-touch-icon.png",
  ],
  // Belt-and-suspenders: keep the heavy/irrelevant trees out of the manifest even
  // if a glob above ever widens.
  globIgnores: [
    "**/covers/**",
    "**/charts/**",
    "**/_next/data/**",
    "**/*.map",
  ],
  // A few first-load JS chunks can exceed the 2 MiB default.
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  // Must match the `declare global` augmentation in src/sw.ts.
  injectionPoint: "self.__SW_MANIFEST",
};

export default config;
