import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type {
  Catalog,
  CatalogEntry,
  ChartDownloadSpec,
  VersionGroup,
} from "@/lib/catalog-shared";
import {
  getChartDownloadSpec,
  resolveVersionIndex,
  UNKNOWN_VERSION_ROUTE_ID,
  versionRouteId,
} from "@/lib/catalog-shared";
import type { CatalogSearchIndexEntry } from "@/lib/catalog-search";
import { entrySlug } from "@/lib/route-slug";
import { MAIMAI_VERSIONS } from "@/lib/version-image";

export type { Catalog, CatalogDifficulty, CatalogEntry } from "@/lib/catalog-shared";

// Monorepo layout: the web app lives at apps/web; the generated catalog lives at
// data/catalog at the repo root (two levels up from the app's cwd during build).
const catalogPath = path.resolve(process.cwd(), "..", "..", "data", "catalog", "index.json");

export const readCatalog = cache(async (): Promise<Catalog> => {
  const raw = await fs.readFile(catalogPath, "utf-8");
  return JSON.parse(raw) as Catalog;
});

export async function readCatalogEntries(): Promise<CatalogEntry[]> {
  const catalog = await readCatalog();
  return catalog.entries;
}

export async function readEntryById(id: string): Promise<CatalogEntry | undefined> {
  const entries = await readCatalogEntries();
  return entries.find((entry) => entry.id === id);
}

// Up to `limit` sibling charts for a detail page's "related" rail — prioritizing
// same artist (most relevant), then same genre, then same version. Builds the
// chart-to-chart internal link graph (crawl depth + answer-engine context) that
// the client-side browse grid can't, since it only links ~24 charts at a time.
export async function readRelatedEntries(
  entry: CatalogEntry,
  limit = 12
): Promise<CatalogEntry[]> {
  const entries = await readCatalogEntries();
  const picked = new Map<string, CatalogEntry>();
  const take = (candidates: CatalogEntry[], max: number) => {
    let added = 0;
    for (const candidate of candidates) {
      if (added >= max || picked.size >= limit) break;
      if (candidate.id === entry.id || picked.has(candidate.id)) continue;
      picked.set(candidate.id, candidate);
      added += 1;
    }
  };

  take(entry.artist ? entries.filter((e) => e.artist === entry.artist) : [], 6);
  take(entry.genreid != null ? entries.filter((e) => e.genreid === entry.genreid) : [], 6);
  take(entry.versionid != null ? entries.filter((e) => e.versionid === entry.versionid) : [], 12);

  return [...picked.values()].slice(0, limit);
}

const readEntryByRouteSlugMap = cache(async () => {
  const entries = await readCatalogEntries();
  const map = new Map<string, CatalogEntry>();

  // The canonical slug (the numeric maimai shortid) is the only chart route.
  for (const entry of entries) {
    map.set(entrySlug(entry), entry);
  }

  return map;
});

export async function readEntryByRouteSlug(
  slug: string
): Promise<CatalogEntry | undefined> {
  const map = await readEntryByRouteSlugMap();
  return map.get(slug);
}

export async function readRouteSlugs(): Promise<string[]> {
  const map = await readEntryByRouteSlugMap();
  return Array.from(map.keys());
}

// Canonical slugs only (one per chart) — for sitemaps / IndexNow, so we don't
// submit the legacy alias URLs that just canonicalize back to these.
export async function readCanonicalSlugs(): Promise<string[]> {
  const entries = await readCatalogEntries();
  return entries.map((entry) => entrySlug(entry));
}

// Per-chart download specs keyed by entry id. Served as a static JSON endpoint
// (/charts/specs.json) and fetched lazily by the catalog browser's select mode,
// so the browse pages don't embed file URLs for every chart.
export const readChartSpecsById = cache(
  async (): Promise<Record<string, ChartDownloadSpec>> => {
    const entries = await readCatalogEntries();
    return Object.fromEntries(entries.map((entry) => [entry.id, getChartDownloadSpec(entry)]));
  }
);

// Minimal client search index (id/slug/titles/artists/aliases) for the home
// hero's instant suggestions, served as a static JSON endpoint. English fields
// are dropped when they duplicate the primary ones to keep the file small.
export const readSearchIndex = cache(async (): Promise<CatalogSearchIndexEntry[]> => {
  const entries = await readCatalogEntries();
  return entries.map((entry) => ({
    id: entry.id,
    slug: entrySlug(entry),
    title: entry.title,
    ...(entry.title_en && entry.title_en !== entry.title ? { title_en: entry.title_en } : {}),
    // The Latin entry point for a kana title, which for roughly a third of the
    // catalog is the *only* one — title_en is empty upstream for every entry.
    // Without it the hero suggestions answer "gekkou" with nothing while the
    // browse page finds the song, which reads as the site being broken.
    ...(entry.title_romaji ? { title_romaji: entry.title_romaji } : {}),
    artist: entry.artist,
    ...(entry.artist_en && entry.artist_en !== entry.artist
      ? { artist_en: entry.artist_en }
      : {}),
    ...(entry.artist_romaji ? { artist_romaji: entry.artist_romaji } : {}),
    ...(entry.aliases?.length ? { aliases: entry.aliases } : {}),
  }));
});

// --- Version grouping for the /versions browse pages ---
// Charts are bucketed by canonical maimai version (via the version icon index),
// which merges catalog variants like "FESTiVAL" and "maimai DX FESTiVAL".

const UNKNOWN_VERSION_SLUG = "unknown";

type VersionDetail = { name: string; slug: string; imageIndex: number | null; entries: CatalogEntry[] };

const readVersionData = cache(async () => {
  const entries = await readCatalogEntries();
  const byIndex = new Map<number, CatalogEntry[]>();
  const unknown: CatalogEntry[] = [];

  for (const entry of entries) {
    const index = resolveVersionIndex(entry);
    if (index === null) {
      unknown.push(entry);
      continue;
    }
    const bucket = byIndex.get(index);
    if (bucket) {
      bucket.push(entry);
    } else {
      byIndex.set(index, [entry]);
    }
  }

  return { byIndex, unknown };
});

// Full grid: all 27 canonical versions in chronological order (count may be 0),
// plus an "Unknown" bucket appended when non-empty.
export async function readVersionGroups(): Promise<VersionGroup[]> {
  const { byIndex, unknown } = await readVersionData();
  // Newest version first (descending: CiRCLE -> maimai); Unknown appended last.
  const groups: VersionGroup[] = [...MAIMAI_VERSIONS].reverse().map((version) => ({
    slug: version.slug,
    name: version.name,
    imageIndex: version.index,
    count: byIndex.get(version.index)?.length ?? 0,
  }));

  if (unknown.length > 0) {
    groups.push({
      slug: UNKNOWN_VERSION_SLUG,
      name: "Unknown",
      imageIndex: null,
      count: unknown.length,
    });
  }

  return groups;
}

// Per-version slim download specs (dir + asset urls), keyed by version slug. Embedded on
// the versions index so whole versions can be batch-downloaded client-side. Only versions
// that actually have charts (+ unknown) get an entry.
export async function readVersionChartSpecs(): Promise<Record<string, ChartDownloadSpec[]>> {
  const { byIndex, unknown } = await readVersionData();
  const specs: Record<string, ChartDownloadSpec[]> = {};

  for (const version of MAIMAI_VERSIONS) {
    const entries = byIndex.get(version.index);
    if (entries && entries.length > 0) {
      specs[version.slug] = entries.map(getChartDownloadSpec);
    }
  }

  if (unknown.length > 0) {
    specs[UNKNOWN_VERSION_SLUG] = unknown.map(getChartDownloadSpec);
  }

  return specs;
}

// Resolves a version by its route id — the maimai versionid (0–26 as a string)
// or "unknown" for the untagged bucket.
export async function readVersionGroup(routeId: string): Promise<VersionDetail | undefined> {
  const { byIndex, unknown } = await readVersionData();

  if (routeId === UNKNOWN_VERSION_ROUTE_ID) {
    return unknown.length > 0
      ? { name: "Unknown", slug: UNKNOWN_VERSION_SLUG, imageIndex: null, entries: unknown }
      : undefined;
  }

  const index = Number(routeId);
  const version = Number.isInteger(index)
    ? MAIMAI_VERSIONS.find((candidate) => candidate.index === index)
    : undefined;
  const entries = version ? byIndex.get(version.index) : undefined;
  if (!version || !entries || entries.length === 0) {
    return undefined;
  }

  return { name: version.name, slug: version.slug, imageIndex: version.index, entries };
}

// Route ids for versions that actually have charts (+ unknown) — for static
// params, sitemap and IndexNow. Excludes the empty (0-chart) versions shown in
// the grid.
export async function readVersionRouteIds(): Promise<string[]> {
  const { byIndex, unknown } = await readVersionData();
  const ids = MAIMAI_VERSIONS.filter(
    (version) => (byIndex.get(version.index)?.length ?? 0) > 0
  ).map((version) => versionRouteId(version.index));

  if (unknown.length > 0) {
    ids.push(UNKNOWN_VERSION_ROUTE_ID);
  }

  return ids;
}
