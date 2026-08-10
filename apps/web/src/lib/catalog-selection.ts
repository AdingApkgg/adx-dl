/**
 * Persistence for the browse page's batch selection.
 *
 * Ticking twenty charts, opening one to check a difficulty and coming back used
 * to drop the lot, because the selection lived only in component state and the
 * detail page is a real navigation. It is stored per browser instead of per
 * deploy: ids are validated against the catalog the page was built from on every
 * read, so a chart that has since left the archive is dropped rather than
 * silently poisoning a batch download.
 */
export const CATALOG_SELECTION_STORAGE_KEY = "astrodx-catalog-selection-v1";

/**
 * Upper bound on a restored selection. The whole catalog is a legitimate
 * selection (~1900 ids), so this is only a guard against a corrupted or
 * hand-edited value growing without limit.
 */
const MAX_RESTORED_IDS = 4000;

/**
 * Validate a parsed storage value into a selection.
 *
 * Accepts both the stored `{ ids: [...] }` object and a bare array, so a value
 * written by a future shape (or hand-edited) still degrades to something usable
 * instead of throwing the selection away.
 */
export function parseCatalogSelection(
  value: unknown,
  knownIds: ReadonlySet<string>
): string[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { ids?: unknown }).ids)
      ? ((value as { ids: unknown[] }).ids)
      : null;
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || seen.has(item) || !knownIds.has(item)) {
      continue;
    }
    seen.add(item);
    ids.push(item);
    if (ids.length >= MAX_RESTORED_IDS) break;
  }
  return ids;
}

/** `window.localStorage`, or null when merely touching it throws (Safari private
 *  browsing, hardened enterprise profiles). */
export function catalogSelectionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCatalogSelection(
  storage: Pick<Storage, "getItem">,
  knownIds: ReadonlySet<string>
): string[] {
  try {
    const raw = storage.getItem(CATALOG_SELECTION_STORAGE_KEY);
    return raw ? parseCatalogSelection(JSON.parse(raw), knownIds) : [];
  } catch {
    return [];
  }
}

export function writeCatalogSelection(
  storage: Pick<Storage, "setItem" | "removeItem">,
  ids: readonly string[]
): void {
  try {
    if (ids.length === 0) {
      // Clearing the selection has to clear the key too, or the next visit
      // restores a batch the user just dismissed.
      storage.removeItem(CATALOG_SELECTION_STORAGE_KEY);
      return;
    }
    storage.setItem(CATALOG_SELECTION_STORAGE_KEY, JSON.stringify({ ids }));
  } catch {
    // Private or full storage must not break selecting charts.
  }
}
