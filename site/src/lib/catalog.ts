import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type { Catalog, CatalogEntry } from "@/lib/catalog-shared";
import { toLegacyRouteSlug, toRouteSlug } from "@/lib/route-slug";

export type { Catalog, CatalogDifficulty, CatalogEntry } from "@/lib/catalog-shared";

const catalogPath = path.resolve(process.cwd(), "..", "catalog", "index.json");

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

  for (const entry of entries) {
    map.set(toRouteSlug(entry.id), entry);

    const legacy = toLegacyRouteSlug(entry.id);
    if (legacy) {
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
