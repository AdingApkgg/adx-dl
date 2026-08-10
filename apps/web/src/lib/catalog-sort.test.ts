import { describe, expect, test } from "bun:test";

import {
  CATALOG_SORT_IDS,
  DEFAULT_CATALOG_SORT,
  entryPeakLevelValue,
  parseCatalogSortId,
  sortCatalogEntries,
  type SortableEntry,
} from "./catalog-sort";

function buildEntry(overrides: Partial<SortableEntry> & { short_id: string }): SortableEntry {
  return {
    title: `Song ${overrides.short_id}`,
    bpm: 150,
    cabinet: "DX",
    versionid: 20,
    difficulties: [{ level: "12" }],
    ...overrides,
  };
}

const ids = (entries: readonly SortableEntry[]) => entries.map((entry) => entry.short_id);

describe("catalog-sort", () => {
  test("只接受清单里的排序 id，其余一律回落到调用方的默认值", () => {
    for (const id of CATALOG_SORT_IDS) {
      expect(parseCatalogSortId(id)).toBe(id);
    }
    expect(parseCatalogSortId("  imported  ")).toBe("imported");
    expect(parseCatalogSortId("level")).toBeNull();
    expect(parseCatalogSortId("")).toBeNull();
    expect(parseCatalogSortId(null)).toBeNull();
    expect(parseCatalogSortId(undefined)).toBeNull();
    expect(DEFAULT_CATALOG_SORT).toBe("default");
  });

  test("难度取谱面里最难的一个，且按 12 < 12+ < 13 的演出顺序比较", () => {
    expect(
      entryPeakLevelValue(
        buildEntry({ short_id: "a", difficulties: [{ level: "8" }, { level: "13+" }, { level: "11" }] })
      )
    ).toBe(13.5);
    // 定数写法与「+」写法落在同一把尺子上。
    expect(entryPeakLevelValue(buildEntry({ short_id: "b", difficulties: [{ level: "13.4" }] }))).toBe(13.4);
    // 宴谱可能只写「宴」，没有任何可解析的等级。
    expect(entryPeakLevelValue(buildEntry({ short_id: "c", difficulties: [{ level: "宴" }] }))).toBeNull();
    expect(entryPeakLevelValue(buildEntry({ short_id: "d", difficulties: [] }))).toBeNull();
  });

  test("难度升序 / 降序，且无等级的谱面两个方向都沉底", () => {
    const entries = [
      buildEntry({ short_id: "mid", difficulties: [{ level: "12+" }] }),
      buildEntry({ short_id: "none", difficulties: [{ level: "宴" }] }),
      buildEntry({ short_id: "high", difficulties: [{ level: "14" }] }),
      buildEntry({ short_id: "low", difficulties: [{ level: "9" }] }),
    ];

    expect(ids(sortCatalogEntries(entries, "level-desc"))).toEqual([
      "high",
      "mid",
      "low",
      "none",
    ]);
    // 升序问的是「最简单的谱是哪些」，不是「哪些谱没标等级」。
    expect(ids(sortCatalogEntries(entries, "level-asc"))).toEqual([
      "low",
      "mid",
      "high",
      "none",
    ]);
  });

  test("BPM 排序同理，null BPM 不会因为方向翻转就冒到顶上", () => {
    const entries = [
      buildEntry({ short_id: "fast", bpm: 220 }),
      buildEntry({ short_id: "unknown", bpm: null }),
      buildEntry({ short_id: "slow", bpm: 90 }),
    ];

    expect(ids(sortCatalogEntries(entries, "bpm-desc"))).toEqual(["fast", "slow", "unknown"]);
    expect(ids(sortCatalogEntries(entries, "bpm-asc"))).toEqual(["slow", "fast", "unknown"]);
  });

  test("曲名排序用调用方传入的 collator（数字段落按数值而非字典序）", () => {
    const entries = [
      buildEntry({ short_id: "10", title: "Alpha 10" }),
      buildEntry({ short_id: "2", title: "Alpha 2" }),
      buildEntry({ short_id: "b", title: "beta" }),
    ];
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    expect(ids(sortCatalogEntries(entries, "title-asc", collator))).toEqual(["2", "10", "b"]);
  });

  test("最新收录按 imported_at 倒序，缺时间戳时回落到版本世代顺序", () => {
    const entries = [
      buildEntry({ short_id: "old", imported_at: "2026-01-02T00:00:00.000Z" }),
      buildEntry({ short_id: "new", imported_at: "2026-08-01T00:00:00.000Z" }),
      buildEntry({ short_id: "undated", versionid: 26 }),
    ];

    // 无时间戳的那条排在两个有时间戳的之后（"" 比任何 ISO 串都小）。
    expect(ids(sortCatalogEntries(entries, "imported"))).toEqual(["new", "old", "undated"]);
  });

  test("默认排序 = 版本世代新→旧，且不改动传入数组", () => {
    const entries = [
      buildEntry({ short_id: "1", versionid: 10 }),
      buildEntry({ short_id: "2", versionid: 26 }),
    ];
    const sorted = sortCatalogEntries(entries, "default");

    expect(ids(sorted)).toEqual(["2", "1"]);
    expect(ids(entries)).toEqual(["1", "2"]);
  });
});
