import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type { Catalog, CatalogEntry } from "@/lib/catalog-shared";
import { entrySlug, toLegacyRouteSlug, toRouteSlug } from "@/lib/route-slug";

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
