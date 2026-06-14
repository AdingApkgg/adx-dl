import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type { Catalog, CatalogEntry, VersionGroup } from "@/lib/catalog-shared";
import { versionSlug } from "@/lib/catalog-shared";
import { entrySlug, toLegacyRouteSlug, toRouteSlug } from "@/lib/route-slug";
import { versionImageIndex } from "@/lib/version-image";

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

  // Pass 1: canonical (readable, directory-derived) slugs win.
  for (const entry of entries) {
    map.set(entrySlug(entry), entry);
  }

  // Pass 2: legacy aliases (FNV hash + URL-encoded id) keep old links resolving,
  // but never shadow a canonical slug.
  for (const entry of entries) {
    const hashed = toRouteSlug(entry.id);
    if (!map.has(hashed)) {
      map.set(hashed, entry);
    }

    const legacy = toLegacyRouteSlug(entry.id);
    if (legacy && !map.has(legacy)) {
      map.set(legacy, entry);
    }
  }

  return map;
});

export async function readEntryByRouteSlug(
  slug: string
): Promise<CatalogEntry | undefined> {
  const map = await readEntryByRouteSlugMap();

  const direct = map.get(slug);
  if (direct) {
    return direct;
  }

  // Static export can hand the dynamic [slug] param to the page percent-encoded
  // (notably for non-ASCII slugs), while the map is keyed by the raw slug.
  // Fall back to the decoded form so CJK chart pages resolve instead of 404ing.
  try {
    const decoded = decodeURIComponent(slug);
    if (decoded !== slug) {
      return map.get(decoded);
    }
  } catch {
    // malformed escape sequence — ignore and fall through
  }

  return undefined;
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

// --- Version (subcategory) grouping for the /versions browse pages ---

const readVersionMap = cache(async () => {
  const entries = await readCatalogEntries();
  const bySlug = new Map<string, { subcategory: string; entries: CatalogEntry[] }>();

  for (const entry of entries) {
    const subcategory = entry.subcategory || "Unknown";
    const slug = versionSlug(subcategory);
    const group = bySlug.get(slug);
    if (group) {
      group.entries.push(entry);
    } else {
      bySlug.set(slug, { subcategory, entries: [entry] });
    }
  }

  return bySlug;
});

export async function readVersionGroups(): Promise<VersionGroup[]> {
  const map = await readVersionMap();
  const groups = Array.from(map.entries()).map(([slug, group]) => ({
    subcategory: group.subcategory,
    slug,
    count: group.entries.length,
  }));

  // Chronological by maimai version icon order; versions without an icon (Unknown) last.
  return groups.sort((a, b) => {
    const ai = versionImageIndex(a.subcategory) ?? Number.MAX_SAFE_INTEGER;
    const bi = versionImageIndex(b.subcategory) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi || a.subcategory.localeCompare(b.subcategory);
  });
}

export async function readVersionGroup(
  slug: string
): Promise<{ subcategory: string; entries: CatalogEntry[] } | undefined> {
  const map = await readVersionMap();
  return map.get(slug);
}

export async function readVersionSlugs(): Promise<string[]> {
  const map = await readVersionMap();
  return Array.from(map.keys());
}
