import { isUtageEntry, type CatalogEntry } from "@/lib/catalog-shared";

/**
 * Deterministic weighted "editor's pick" selection for the homepage spotlight
 * carousel and the featured rail. Everything is pure and seeded so a given
 * (seed, catalog) pair always renders the same static export:
 *
 * - Weighted sampling (Efraimidis–Spirakis max-key): fresh imports, covers,
 *   PVs and the newest version era are boosted; UTAGE specials are damped;
 *   every chart keeps a base weight so the long tail still rotates in.
 * - Diversity constraints applied greedily over the weighted order: the
 *   spotlight uses distinct versions, the rail caps two per version and
 *   reserves slots so low/mid/high difficulty bands are all represented
 *   whenever the pool allows.
 */

export function seedFromString(value: string): number {
  // FNV-1a, 32-bit.
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hasCover(entry: CatalogEntry): boolean {
  return Boolean(
    entry.media.cover_avif || entry.media.cover_webp || entry.media.cover_url
  );
}

/** Difficulty band by the chart's hardest level: low <10, mid 10–12.x, high ≥13. */
export type DifficultyBand = "low" | "mid" | "high";

export function difficultyBand(entry: CatalogEntry): DifficultyBand {
  let top = 0;
  for (const difficulty of entry.difficulties) {
    const value = Number.parseFloat(difficulty.level);
    if (Number.isFinite(value) && value > top) {
      top = value;
    }
  }
  if (top >= 13) return "high";
  if (top >= 10) return "mid";
  return "low";
}

const DAY_MS = 86_400_000;

function selectionWeight(
  entry: CatalogEntry,
  referenceMs: number,
  newestVersionId: number
): number {
  let weight = 1;
  if (hasCover(entry)) weight *= 3;
  if (entry.assets.has_pv) weight *= 1.5;
  // Freshly imported charts get a temporary spotlight boost.
  if (entry.imported_at) {
    const age = referenceMs - Date.parse(entry.imported_at);
    if (Number.isFinite(age) && age >= 0) {
      if (age <= 30 * DAY_MS) weight *= 2.5;
      else if (age <= 90 * DAY_MS) weight *= 1.5;
    }
  }
  if (entry.versionid !== undefined && entry.versionid === newestVersionId) {
    weight *= 1.25;
  }
  // UTAGE specials are niche — present, but not headline material.
  if (isUtageEntry(entry)) weight *= 0.5;
  return weight;
}

/**
 * Weighted order without replacement: per-entry random keyed by the entry id
 * (order-independent), ranked by u^(1/w) descending. Higher weight → higher
 * expected rank, while every entry keeps a nonzero chance.
 */
function weightedOrder(
  entries: readonly CatalogEntry[],
  seed: number,
  referenceMs: number
): CatalogEntry[] {
  let newestVersionId = -1;
  for (const entry of entries) {
    if (entry.versionid !== undefined && entry.versionid > newestVersionId) {
      newestVersionId = entry.versionid;
    }
  }
  return entries
    .map((entry) => {
      const u = mulberry32(seed ^ seedFromString(entry.id))();
      const weight = selectionWeight(entry, referenceMs, newestVersionId);
      return { entry, key: Math.pow(u, 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .map((ranked) => ranked.entry);
}

/** Greedy pick honoring a per-version cap; relaxes the cap if the pool runs dry. */
function pickWithVersionCap(
  ordered: readonly CatalogEntry[],
  count: number,
  perVersionCap: number,
  exclude: ReadonlySet<string>
): CatalogEntry[] {
  const picked: CatalogEntry[] = [];
  const perVersion = new Map<number, number>();
  for (const entry of ordered) {
    if (picked.length >= count) break;
    if (exclude.has(entry.id)) continue;
    const version = entry.versionid ?? -1;
    if ((perVersion.get(version) ?? 0) >= perVersionCap) continue;
    perVersion.set(version, (perVersion.get(version) ?? 0) + 1);
    picked.push(entry);
  }
  // Cap left slots empty (tiny or single-version catalogs): fill unconstrained.
  if (picked.length < count) {
    const chosen = new Set(picked.map((entry) => entry.id));
    for (const entry of ordered) {
      if (picked.length >= count) break;
      if (exclude.has(entry.id) || chosen.has(entry.id)) continue;
      picked.push(entry);
    }
  }
  return picked;
}

export type FeaturedSelection = {
  /** Carousel entries — cover-bearing, distinct versions (pool permitting). */
  spotlight: CatalogEntry[];
  /** Rail entries — ≤2 per version, all difficulty bands when possible. */
  featured: CatalogEntry[];
};

export function selectFeatured(
  entries: readonly CatalogEntry[],
  options: {
    seed: number;
    /** Build reference time (ms) for recency weighting — pass a day-stable value. */
    referenceMs: number;
    spotlightCount?: number;
    featuredCount?: number;
    /** Already shown elsewhere (e.g. the "latest" rail) — excluded from the rail. */
    excludeFromFeatured?: ReadonlySet<string>;
  }
): FeaturedSelection {
  const {
    seed,
    referenceMs,
    spotlightCount = 3,
    featuredCount = 6,
    excludeFromFeatured = new Set<string>(),
  } = options;

  const ordered = weightedOrder(entries, seed, referenceMs);

  // Spotlight: covers are mandatory for the carousel art; fall back to
  // uncovered entries only when the catalog cannot fill the frames.
  const covered = ordered.filter(hasCover);
  const spotlight = pickWithVersionCap(covered, spotlightCount, 1, new Set());
  if (spotlight.length < spotlightCount) {
    const chosen = new Set(spotlight.map((entry) => entry.id));
    for (const entry of ordered) {
      if (spotlight.length >= spotlightCount) break;
      if (!chosen.has(entry.id)) spotlight.push(entry);
    }
  }

  // Rail: exclude the spotlight + caller-provided ids, cap two per version,
  // then swap tail picks so every difficulty band is represented if the
  // remaining pool has it.
  const RAIL_VERSION_CAP = 2;
  const exclude = new Set<string>([
    ...excludeFromFeatured,
    ...spotlight.map((entry) => entry.id),
  ]);
  const featured = pickWithVersionCap(
    ordered,
    featuredCount,
    RAIL_VERSION_CAP,
    exclude
  );

  const presentBands = new Set(featured.map(difficultyBand));
  const missingBands = (["low", "mid", "high"] as const).filter(
    (band) => !presentBands.has(band)
  );
  for (const band of missingBands) {
    const chosen = new Set(featured.map((entry) => entry.id));
    // Try candidates in weighted order; a swap must (a) not orphan an
    // already-satisfied band and (b) keep the candidate's version within the
    // per-version cap AFTER the eviction — evicting a same-version entry is
    // therefore always acceptable. Without (b) a saturated version could end
    // up with three rail slots (caught by adversarial review on real data).
    outer: for (const candidate of ordered) {
      if (exclude.has(candidate.id) || chosen.has(candidate.id)) continue;
      if (difficultyBand(candidate) !== band) continue;
      const candidateVersion = candidate.versionid ?? -1;
      for (let i = featured.length - 1; i >= 0; i--) {
        const evictedBand = difficultyBand(featured[i]);
        const evictedBandCount = featured.filter(
          (entry) => difficultyBand(entry) === evictedBand
        ).length;
        if (evictedBandCount <= 1) continue;
        const versionCountAfter =
          featured.filter(
            (entry, j) => j !== i && (entry.versionid ?? -1) === candidateVersion
          ).length + 1;
        if (versionCountAfter > RAIL_VERSION_CAP) continue;
        featured[i] = candidate;
        break outer;
      }
    }
  }

  return { spotlight, featured };
}
