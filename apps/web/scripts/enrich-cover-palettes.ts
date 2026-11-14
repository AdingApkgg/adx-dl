/** Build-only palette extraction. Warm builds do no HTTP or image work; stale
 * entries use conditional HTTP requests. Failed refreshes preserve old records. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Catalog, CatalogEntry } from "../src/lib/catalog-shared";
import { paletteFromPixels, type CoverPalette } from "../src/lib/cover-palette";
import {
  paletteFingerprint,
  paletteSource,
  type CachedPalette,
  type CoverPaletteCache,
} from "../src/lib/cover-palette-cache";
export type { CachedPalette } from "../src/lib/cover-palette-cache";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AGE = 7 * 86400000;
export async function extractPalette(input: Uint8Array): Promise<CoverPalette> {
  const { data } = await sharp(input, { limitInputPixels: 16_000_000 })
    .rotate()
    .resize(32, 32, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return paletteFromPixels(data);
}
export async function refreshPalette({
  source,
  fingerprint,
  cached,
  now = Date.now(),
  force = false,
  request = fetch,
  extract = extractPalette,
}: {
  source: string;
  fingerprint: string;
  cached?: CachedPalette;
  now?: number;
  force?: boolean;
  request?: typeof fetch;
  extract?: (input: Uint8Array) => Promise<CoverPalette>;
}): Promise<CachedPalette> {
  const same = cached?.source === source && cached.fingerprint === fingerprint;
  if (same && !force && now - cached.checkedAt < MAX_AGE) return cached;
  try {
    const headers: Record<string, string> = {};
    if (same && cached.etag) headers["If-None-Match"] = cached.etag;
    else if (same && cached.lastModified) headers["If-Modified-Since"] = cached.lastModified;
    const response = await request(source, { headers, signal: AbortSignal.timeout(10000) });
    if (response.status === 304 && same) return { ...cached, checkedAt: now };
    if (!response.ok) throw Error(`Cover HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw Error("Cover too large");
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("Empty cover");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_BYTES) throw Error("Cover too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const input = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    const palette = await extract(input);
    return {
      source,
      fingerprint,
      checkedAt: now,
      palette,
      ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
      ...(response.headers.get("last-modified")
        ? { lastModified: response.headers.get("last-modified")! }
        : {}),
    };
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}
async function main() {
  const root = path.resolve(process.cwd(), "../..");
  const file = path.join(root, "data/catalog/cover-palettes.json");
  const catalog: Catalog = JSON.parse(
    await readFile(path.join(root, "data/catalog/index.json"), "utf8"),
  );
  let cache: CoverPaletteCache = { version: 1, entries: {} };
  try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    if (previous.version === 1) cache = previous;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  cache.failures ??= {};
  const failures = cache.failures;
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
  const selected = catalog.entries
    .filter((e) => e.assets.has_background && paletteSource(e))
    .slice(0, limit);
  const started = Date.now();
  const budgetIndex = args.indexOf("--budget-ms");
  const budget = budgetIndex >= 0 ? Number(args[budgetIndex + 1]) : 120000;
  let cursor = 0,
    changed = 0,
    hits = 0,
    failed = 0,
    requests = 0,
    decoded = 0,
    bytes = 0;
  const request: typeof fetch = async (input, init) => {
    const source = String(input);
    if (source.startsWith("/covers/"))
      return new Response(await readFile(path.join(process.cwd(), "public", source)));
    requests++;
    return fetch(input, init);
  };
  const worker = async () => {
    for (;;) {
      if (Date.now() - started >= budget) return;
      const entry: CatalogEntry | undefined = selected[cursor++];
      if (!entry) return;
      const fingerprint = paletteFingerprint(entry);
      if (
        !args.includes("--revalidate") &&
        failures[entry.id]?.fingerprint === fingerprint &&
        failures[entry.id].retryAfter > Date.now()
      ) {
        failed++;
        continue;
      }
      const old = cache.entries[entry.id];
      try {
        const updated = await refreshPalette({
          source: paletteSource(entry),
          fingerprint: paletteFingerprint(entry),
          cached: old,
          force: args.includes("--revalidate"),
          request,
          extract: async (input) => {
            decoded++;
            bytes += input.length;
            return extractPalette(input);
          },
        });
        cache.entries[entry.id] = updated;
        if (updated === old) {
          hits++;
          if (
            fingerprint !== old.fingerprint ||
            args.includes("--revalidate") ||
            Date.now() - old.checkedAt >= MAX_AGE
          )
            failures[entry.id] = { fingerprint, retryAfter: Date.now() + 86400000 };
        } else {
          changed++;
          delete failures[entry.id];
        }
      } catch {
        failed++;
        failures[entry.id] = { fingerprint, retryAfter: Date.now() + 86400000 };
      }
      if ((changed + hits + failed) % 100 === 0)
        console.log(`Cover palettes progress: ${changed + hits + failed}/${selected.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  // Keep only catalog entries so deleted artwork does not grow the cache forever.
  const ids = new Set(catalog.entries.map((e) => e.id));
  for (const id of Object.keys(cache.entries)) if (!ids.has(id)) delete cache.entries[id];
  for (const id of Object.keys(failures)) if (!ids.has(id)) delete failures[id];
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache)}\n`);
  await rename(temporary, file);
  console.log(
    `Cover palettes: ${changed} refreshed, ${hits} reused, ${failed} unavailable; ${Object.keys(cache.entries).length} cached; ${requests} HTTP requests, ${decoded} decodes, ${bytes} downloaded bytes, ${Math.max(0, selected.length - cursor)} deferred; ${Date.now() - started}ms`,
  );
}
if (import.meta.main) await main();
