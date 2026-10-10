import { buildLocalePath, type Locale } from "./i18n";
import { entrySlug } from "./route-slug";
import { localChartAssetUrl, type CatalogEntry } from "./catalog-shared";

export function buildPreviewHref(entry: { id: string; slug?: string | null }, locale: Locale, slot?: number): string {
  const pathname = buildLocalePath(`/preview/${encodeURIComponent(entrySlug(entry))}`, locale);
  return slot === undefined ? pathname : `${pathname}?diff=${slot}`;
}

export function readPreviewDifficulty(params: URLSearchParams): number | null {
  const raw = params.get("diff")?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function legacyPreviewHref(current: URL, entry: { id: string; slug?: string | null }, locale: Locale): string {
  const params = new URLSearchParams(current.search);
  params.delete("preview");
  const query = params.toString();
  return `${buildPreviewHref(entry, locale)}${query ? `?${query}` : ""}${current.hash}`;
}

export function getChartPreviewAssets(entry: CatalogEntry) {
  return {
    maidataUrl: localChartAssetUrl(entry, "maidata.txt"),
    coverUrl: entry.assets.has_background || entry.media.cover_url ? entry.media.cover_url || undefined : undefined,
    audioUrl: entry.media.audio_url || undefined,
    videoUrl: entry.media.pv_url || undefined,
  };
}
