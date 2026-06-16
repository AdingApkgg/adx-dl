import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type {
  Catalog,
  CatalogEntry,
  ChartDownloadSpec,
  VersionGroup,
} from "@/lib/catalog-shared";
import { getChartDownloadSpec } from "@/lib/catalog-shared";
import { entrySlug } from "@/lib/route-slug";
import { MAIMAI_VERSIONS, versionImageIndex } from "@/lib/version-image";

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
    const index = versionImageIndex(entry.version);
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

// Full grid: all 26 canonical versions in chronological order (count may be 0),
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

export async function readVersionGroup(slug: string): Promise<VersionDetail | undefined> {
  const { byIndex, unknown } = await readVersionData();

  if (slug === UNKNOWN_VERSION_SLUG) {
    return unknown.length > 0
      ? { name: "Unknown", slug, imageIndex: null, entries: unknown }
      : undefined;
  }

  const version = MAIMAI_VERSIONS.find((candidate) => candidate.slug === slug);
  const entries = version ? byIndex.get(version.index) : undefined;
  if (!version || !entries || entries.length === 0) {
    return undefined;
  }

  return { name: version.name, slug, imageIndex: version.index, entries };
}

// Slugs for versions that actually have charts (+ unknown) — for static params,
// sitemap and IndexNow. Excludes the empty (0-chart) versions shown in the grid.
export async function readVersionSlugs(): Promise<string[]> {
  const { byIndex, unknown } = await readVersionData();
  const slugs = MAIMAI_VERSIONS.filter(
    (version) => (byIndex.get(version.index)?.length ?? 0) > 0
  ).map((version) => version.slug);

  if (unknown.length > 0) {
    slugs.push(UNKNOWN_VERSION_SLUG);
  }

  return slugs;
}
