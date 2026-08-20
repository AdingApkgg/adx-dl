/**
 * The "the app shell changed" protocol shared by the service worker and the page.
 *
 * Imported from BOTH `src/sw.ts` (bundled by esbuild through `serwist build`) and
 * `service-worker-update.ts` (bundled by Next), so it must stay free of DOM and
 * worker globals alike.
 *
 * Why this exists: the worker activates immediately (`skipWaiting`), and doing so
 * sweeps precache entries the new build no longer lists. A tab still running the
 * old build then lazy-loads a chunk that is gone from both the cache and the
 * origin (GitHub Pages replaces the whole tree on deploy) — a ChunkLoadError. The
 * fix is for every tab to reload, but only when it actually has to: CI redeploys
 * the whole site daily just to rotate the homepage spotlight, and reloading every
 * open tab for that would be pure noise.
 */

/** A precache manifest entry as `@serwist/build` injects it at `self.__SW_MANIFEST`. */
export type PrecacheManifestEntry = string | { url: string; revision?: string | null };

/** Message the worker posts to every window client when a reload is required. */
export const SHELL_UPDATED_MESSAGE = "astrodx-shell-updated";

/** Cache holding the previous build's shell keys. Not a response cache. */
export const SHELL_STATE_CACHE = "astrodx-shell-state";

/** Synthetic request key inside {@link SHELL_STATE_CACHE}. */
export const SHELL_STATE_KEY = "/__astrodx-shell-assets";

const NEXT_STATIC = "_next/static/";

// `_next/static/<buildId>/_buildManifest.js` and `_ssgManifest.js` are the only
// precached files whose URL is not content-hashed, and the buildId is a fresh
// random string on every `next build`. Nothing in the App Router export requests
// them (verified against a real `out/`), so they are pure churn: left in, every
// deploy would look like a changed shell.
const VOLATILE_NEXT_MANIFEST = /_next\/static\/[^/]+\/_(?:build|ssg)Manifest\.js$/;

function entryKey(entry: PrecacheManifestEntry): string {
  return typeof entry === "string" ? `${entry}@` : `${entry.url}@${entry.revision ?? ""}`;
}

function entryUrl(entry: PrecacheManifestEntry): string {
  return typeof entry === "string" ? entry : entry.url;
}

/**
 * The precached assets an already-open tab can still demand: the content-hashed
 * `_next/static` chunks, stylesheets and fonts its build graph points at.
 *
 * Everything else in the manifest is irrelevant to that question. `offline.html`
 * in particular embeds the buildId, so its revision changes on every single
 * build while the code it falls back to has not.
 */
export function shellAssetKeys(entries: readonly PrecacheManifestEntry[] = []): string[] {
  const shell = entries.filter(
    (entry) =>
      entryUrl(entry).includes(NEXT_STATIC) && !VOLATILE_NEXT_MANIFEST.test(entryUrl(entry))
  );
  // If the manifest ever stops looking like a Next export — a renamed asset
  // directory, a different bundler — fall back to the whole thing rather than to
  // an empty list. Keys that can never change would leave open tabs on a build
  // whose chunks are gone from the origin, which is the exact failure this
  // module exists to prevent. Reloading too often is the survivable direction.
  const considered = shell.length > 0 ? shell : entries;
  return [...new Set(considered.map(entryKey))].sort();
}

/**
 * Whether any asset the previous build precached is missing from the new one.
 *
 * Removal is the precise trigger: filenames carry a content hash, so a URL that
 * disappeared is a file whose bytes changed (or that is gone entirely) — exactly
 * what an open tab would fail to lazy-load. A build that only ADDS assets leaves
 * every old dependency graph intact and needs no reload.
 */
export function hasStaleShellAssets(
  previous: readonly string[],
  next: readonly string[]
): boolean {
  const current = new Set(next);
  return previous.some((key) => !current.has(key));
}
