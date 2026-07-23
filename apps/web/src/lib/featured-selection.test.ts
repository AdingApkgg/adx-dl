import { describe, expect, test } from "bun:test";

import type { CatalogEntry } from "@/lib/catalog-shared";
import {
  difficultyBand,
  hasCover,
  seedFromString,
  selectFeatured,
} from "@/lib/featured-selection";

const REF_MS = Date.parse("2026-07-24T00:00:00+08:00");

function makeEntry(overrides: {
  id: string;
  versionid?: number;
  level?: string;
  cover?: boolean;
  pv?: boolean;
  importedAt?: string;
  cabinet?: string;
}): CatalogEntry {
  const {
    id,
    versionid = 0,
    level = "10.0",
    cover = true,
    pv = false,
    importedAt,
    cabinet = "standard",
  } = overrides;
  return {
    id,
    title: id,
    artist: "artist",
    category: "cat",
    subcategory: "sub",
    version: `v${versionid}`,
    versionid,
    genre: "genre",
    cabinet,
    short_id: id.replace(/\D/g, "") || "0",
    bpm: 150,
    assets: { has_audio: true, has_background: cover, has_pv: pv },
    difficulties: [{ slot: 5, name: "Master", level, designer: "-" }],
    files: { maidata: "maidata.txt" },
    media: {
      cover_url: cover ? `https://cdn.example/${id}/bg.png` : "",
      audio_url: `https://cdn.example/${id}/track.mp3`,
      pv_url: pv ? `https://cdn.example/${id}/pv.mp4` : "",
      entry_base_url: `https://cdn.example/${id}/`,
    },
    remote_dir_name: id,
    ...(importedAt ? { imported_at: importedAt } : {}),
  } as unknown as CatalogEntry;
}

function makePool(): CatalogEntry[] {
  const pool: CatalogEntry[] = [];
  for (let v = 0; v < 6; v++) {
    for (let i = 0; i < 10; i++) {
      const level = i % 3 === 0 ? "8.0" : i % 3 === 1 ? "11.0" : "13.5";
      pool.push(
        makeEntry({
          id: `v${v}-song-${i}`,
          versionid: v,
          level,
          cover: i % 4 !== 3,
          pv: i % 5 === 0,
        })
      );
    }
  }
  return pool;
}

describe("featured selection", () => {
  test("is deterministic for a given seed and rotates across seeds", () => {
    const pool = makePool();
    const a1 = selectFeatured(pool, { seed: seedFromString("2026-07-24"), referenceMs: REF_MS });
    const a2 = selectFeatured(pool, { seed: seedFromString("2026-07-24"), referenceMs: REF_MS });
    const b = selectFeatured(pool, { seed: seedFromString("2026-07-25"), referenceMs: REF_MS });

    expect(a1.spotlight.map((e) => e.id)).toEqual(a2.spotlight.map((e) => e.id));
    expect(a1.featured.map((e) => e.id)).toEqual(a2.featured.map((e) => e.id));

    const aIds = [...a1.spotlight, ...a1.featured].map((e) => e.id).join(",");
    const bIds = [...b.spotlight, ...b.featured].map((e) => e.id).join(",");
    expect(aIds).not.toEqual(bIds);
  });

  test("selection ignores input array order", () => {
    const pool = makePool();
    const seed = seedFromString("2026-07-24");
    const forward = selectFeatured(pool, { seed, referenceMs: REF_MS });
    const reversed = selectFeatured([...pool].reverse(), { seed, referenceMs: REF_MS });
    expect(forward.spotlight.map((e) => e.id)).toEqual(reversed.spotlight.map((e) => e.id));
    expect(forward.featured.map((e) => e.id)).toEqual(reversed.featured.map((e) => e.id));
  });

  test("spotlight prefers covers and distinct versions", () => {
    const pool = makePool();
    const { spotlight } = selectFeatured(pool, {
      seed: seedFromString("any-day"),
      referenceMs: REF_MS,
    });
    expect(spotlight).toHaveLength(3);
    expect(spotlight.every(hasCover)).toBe(true);
    expect(new Set(spotlight.map((e) => e.versionid)).size).toBe(3);
  });

  test("rail caps two per version, excludes given ids and spotlight", () => {
    const pool = makePool();
    const exclude = new Set(pool.slice(0, 6).map((e) => e.id));
    const { spotlight, featured } = selectFeatured(pool, {
      seed: seedFromString("2026-07-24"),
      referenceMs: REF_MS,
      excludeFromFeatured: exclude,
    });
    expect(featured).toHaveLength(6);
    const spotlightIds = new Set(spotlight.map((e) => e.id));
    for (const entry of featured) {
      expect(exclude.has(entry.id)).toBe(false);
      expect(spotlightIds.has(entry.id)).toBe(false);
    }
    const perVersion = new Map<number | undefined, number>();
    for (const entry of featured) {
      perVersion.set(entry.versionid, (perVersion.get(entry.versionid) ?? 0) + 1);
    }
    for (const count of perVersion.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  test("rail covers all difficulty bands when the pool has them", () => {
    const pool = makePool();
    for (let day = 20; day < 30; day++) {
      const { featured } = selectFeatured(pool, {
        seed: seedFromString(`2026-07-${day}`),
        referenceMs: REF_MS,
      });
      const bands = new Set(featured.map(difficultyBand));
      expect(bands.has("low")).toBe(true);
      expect(bands.has("mid")).toBe(true);
      expect(bands.has("high")).toBe(true);
    }
  });

  test("fresh imports are strongly boosted", () => {
    // 200 stale charts vs 8 fresh ones: fresh entries should reliably appear.
    const pool: CatalogEntry[] = [];
    for (let i = 0; i < 200; i++) {
      pool.push(makeEntry({ id: `old-${i}`, versionid: i % 8 }));
    }
    for (let i = 0; i < 8; i++) {
      pool.push(
        makeEntry({
          id: `fresh-${i}`,
          versionid: i % 8,
          importedAt: "2026-07-20T00:00:00+00:00",
        })
      );
    }
    let freshHits = 0;
    for (let day = 1; day <= 20; day++) {
      const { spotlight, featured } = selectFeatured(pool, {
        seed: seedFromString(`day-${day}`),
        referenceMs: REF_MS,
      });
      freshHits += [...spotlight, ...featured].filter((e) =>
        e.id.startsWith("fresh-")
      ).length;
    }
    // Unweighted baseline: 9 picks/day × 8/208 × 20 days ≈ 7 hits. With the
    // 2.5× fresh boost the pairwise-win expectation is ≈ 16 — assert we sit
    // clearly above the unweighted floor with room for seed variance.
    expect(freshHits).toBeGreaterThan(10);
  });

  test("band repair never breaks the per-version cap (adversarial regression)", () => {
    // Low-band charts exist ONLY in version 1, which the weighted order tends
    // to saturate first: the band-repair swap used to insert a third v1 entry.
    const pool: CatalogEntry[] = [];
    for (let v = 0; v < 4; v++) {
      for (let i = 0; i < 4; i++) {
        pool.push(makeEntry({ id: `v${v}-hi-${i}`, versionid: v, level: "14.0" }));
      }
    }
    pool.push(makeEntry({ id: "v1-low", versionid: 1, level: "5.0" }));

    for (let seed = 0; seed < 200; seed++) {
      const { spotlight, featured } = selectFeatured(pool, { seed, referenceMs: REF_MS });
      const perVersion = new Map<number | undefined, number>();
      for (const entry of featured) {
        perVersion.set(entry.versionid, (perVersion.get(entry.versionid) ?? 0) + 1);
      }
      for (const count of perVersion.values()) {
        expect(count).toBeLessThanOrEqual(2);
      }
      // The sole low chart always surfaces somewhere: either the spotlight
      // grabbed it, or the rail repair swapped it in (evicting a same-version
      // entry keeps that legal under the cap).
      const lowShown = [...spotlight, ...featured].some(
        (entry) => difficultyBand(entry) === "low"
      );
      expect(lowShown).toBe(true);
    }
  });

  test("degrades gracefully on tiny pools", () => {
    const pool = [makeEntry({ id: "only-1", cover: false }), makeEntry({ id: "only-2" })];
    const { spotlight, featured } = selectFeatured(pool, {
      seed: 1,
      referenceMs: REF_MS,
    });
    expect(spotlight).toHaveLength(2);
    expect(featured).toHaveLength(0);
  });
});
