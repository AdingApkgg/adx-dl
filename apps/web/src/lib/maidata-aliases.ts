/**
 * Community aliases (别名) that may ride along in a packed maidata's `&title`.
 *
 * The catalog carries ~12k nicknames (lxns + yuzuchan, see the pipeline), and a
 * device-local download setting lets them be appended to the title at pack
 * time so a chart can be found by nickname inside AstroDX's own search. Not
 * every alias is worth a title's width: this module decides which ones are,
 * builds the build-time manifest (`/charts/aliases.json`, keyed by shortid)
 * that the download store fetches lazily, and validates it on the way in.
 *
 * Keyed by `&shortid` rather than travelling inside download specs on purpose:
 * the pack phase reads the id out of each maidata itself, so persisted jobs,
 * history reruns, stale cached specs and custom sources all pick up the same
 * aliases without the spec format or the checkpoint schema knowing about them.
 */
import type { CatalogEntry } from "./catalog-shared";

export const PACKABLE_ALIAS_INDEX_URL = "/charts/aliases.json";

/** Most nicknames that fit in a title. The median song has 4 usable ones. */
export const MAX_PACKABLE_ALIASES = 5;
/** Longer than this and it is a description, not a nickname (p99 is 22). */
export const MAX_PACKABLE_ALIAS_CHARS = 24;

/** `&shortid` → the aliases worth appending, in catalog order. */
export type PackableAliasIndex = Record<string, string[]>;

/**
 * The form two strings are compared in: a leading `[X]` kind marker dropped
 * (utage titles carry one, and alias lists copy it), whitespace removed, case
 * folded — "[協]Love You", "[協]love you" and "love you" are all the same name.
 */
function comparable(value: string): string {
  return value
    .replace(/^\s*\[[^\]]*\]/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** `&` would read as a new maidata field; a control character breaks the line. */
function unpackable(alias: string): boolean {
  for (const char of alias) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "&" || code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The aliases of a song worth appending to its title: not a respelling of the
 * title itself (1.4k aliases are exactly that), not something the title
 * already contains, safe on a maidata line, short, deduplicated, and capped.
 * Catalog order is kept — the sources list the common nicknames first.
 */
export function packableAliases(
  title: string,
  aliases: readonly string[] | undefined
): string[] {
  if (!aliases?.length) {
    return [];
  }
  const titleKey = comparable(title);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    if (alias === "" || alias.length > MAX_PACKABLE_ALIAS_CHARS || unpackable(alias)) {
      continue;
    }
    const key = comparable(alias);
    if (key === "" || titleKey.includes(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(alias);
    if (result.length >= MAX_PACKABLE_ALIASES) {
      break;
    }
  }
  return result;
}

/** The manifest body: every chart that has at least one packable alias. */
export function buildPackableAliasIndex(
  entries: ReadonlyArray<Pick<CatalogEntry, "short_id" | "title" | "aliases">>
): PackableAliasIndex {
  const index: PackableAliasIndex = {};
  for (const entry of entries) {
    const id = entry.short_id.trim();
    if (id === "") {
      continue;
    }
    const aliases = packableAliases(entry.title, entry.aliases);
    if (aliases.length > 0) {
      index[id] = aliases;
    }
  }
  return index;
}

/** Defensive read of the fetched manifest: anything malformed is simply absent. */
export function parsePackableAliasIndex(value: unknown): PackableAliasIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const index: PackableAliasIndex = {};
  for (const [key, aliases] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(aliases)) {
      continue;
    }
    const strings = aliases.filter((alias): alias is string => typeof alias === "string");
    if (strings.length > 0) {
      index[key] = strings;
    }
  }
  return index;
}

let indexPromise: Promise<PackableAliasIndex> | null = null;

/**
 * The manifest, fetched once per session and shared by every job that packs
 * with aliases on. A failure evicts the memo so the next job retries instead
 * of inheriting a rejected promise for the rest of the session.
 */
export function loadPackableAliasIndex(): Promise<PackableAliasIndex> {
  if (!indexPromise) {
    indexPromise = fetch(PACKABLE_ALIAS_INDEX_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${PACKABLE_ALIAS_INDEX_URL} responded ${response.status}`);
        }
        return parsePackableAliasIndex(await response.json());
      })
      .catch((error: unknown) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

/** Test seam: the memo is module state, so it must reset between test cases. */
export function resetPackableAliasIndexForTests(): void {
  indexPromise = null;
}
