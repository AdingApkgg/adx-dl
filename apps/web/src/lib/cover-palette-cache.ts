import type { CatalogEntry } from "./catalog-shared";
import { isCoverPalette, type CoverPalette } from "./cover-palette";
export type CachedPalette = {
  source: string;
  fingerprint: string;
  checkedAt: number;
  etag?: string;
  lastModified?: string;
  palette: CoverPalette;
};
export type CoverPaletteCache = {
  version: 1;
  entries: Record<string, CachedPalette>;
  failures?: Record<string, { fingerprint: string; retryAfter: number }>;
};
export function paletteSource(entry: CatalogEntry): string {
  return entry.media.cover_webp || entry.media.cover_url;
}
export function paletteFingerprint(entry: CatalogEntry): string {
  return JSON.stringify([
    paletteSource(entry),
    entry.file_bytes?.background ?? null,
    entry.imported_at ?? null,
  ]);
}
export function cachedPaletteForEntry(
  entry: CatalogEntry,
  cache: CoverPaletteCache,
): CoverPalette | undefined {
  const item = cache.version === 1 ? cache.entries[entry.id] : undefined;
  return item?.source === paletteSource(entry) &&
    item.fingerprint === paletteFingerprint(entry) &&
    isCoverPalette(item.palette)
    ? item.palette
    : undefined;
}
