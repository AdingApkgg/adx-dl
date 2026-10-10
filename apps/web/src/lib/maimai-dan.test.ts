import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CatalogCardEntry } from "./catalog-shared";
import { DAN_COURSES, getEntryDanIds, orderCatalogByDan, parseDanIds, resolveDanCourse } from "./maimai-dan";

const entry = (short_id: string, cabinet = "DX", slot = 2) => ({
  short_id,
  cabinet,
  difficulties: [{ slot, level: "2", designer: "" }],
});

describe("official dan chart matching", () => {
  test("matches song type and the prescribed simai difficulty, not just a title or base id", () => {
    expect(getEntryDanIds(entry("10256"))).toEqual(["1"]);
    expect(getEntryDanIds(entry("256", "SD"))).toEqual([]);
    expect(getEntryDanIds(entry("10256", "SD"))).toEqual([]);
    expect(getEntryDanIds(entry("10256", "DX", 5))).toEqual([]);
    expect(getEntryDanIds(entry("10256", "DX", 0))).toEqual([]);
    expect(getEntryDanIds(entry("100256", "UTAGE"))).toEqual([]);
  });

  test("restores only known dan ids from shared links", () => {
    expect([...parseDanIds("1, 11,22,11,23,unknown")]).toEqual(["1", "11", "22"]);
    expect([...parseDanIds(null)]).toEqual([]);
  });

  test("retains course order and missing positions when the catalog is partial", () => {
    const items = [entry("617", "SD"), entry("10319"), entry("10256")];
    const resolved = resolveDanCourse(DAN_COURSES[0], items);
    expect(resolved.map((chart) => [chart.order, chart.entry?.short_id ?? null])).toEqual([
      [1, "10256"], [2, null], [3, "10319"], [4, "617"],
    ]);
    expect(resolved[1].songId).toBe("11052");
  });

  test("orders matching charts by course while preserving unrelated batch selections", () => {
    const items = [entry("99999"), entry("617", "SD"), entry("10319"), entry("10256")];
    expect(orderCatalogByDan(items, [DAN_COURSES[0]]).map((item) => item.short_id)).toEqual([
      "10256", "10319", "617", "99999",
    ]);
    expect(items.map((item) => item.short_id)).toEqual(["99999", "617", "10319", "10256"]);
  });

  test("all current CN course charts resolve to their prescribed difficulty in the real catalog", () => {
    const catalog = JSON.parse(readFileSync(new URL("../../../../data/catalog/index.json", import.meta.url), "utf8"));
    const entries: CatalogCardEntry[] = catalog.entries;
    const resolved = DAN_COURSES.flatMap((course) => resolveDanCourse(course, entries));
    expect(DAN_COURSES).toHaveLength(22);
    expect(resolved).toHaveLength(88);
    expect(resolved.filter((chart) => !chart.entry || !chart.difficulty)).toEqual([]);
    expect(resolveDanCourse(DAN_COURSES[21], entries).map((chart) => [chart.songId, chart.difficulty?.slot])).toEqual([
      ["834", 6], ["11612", 5], ["11662", 5], ["11663", 6],
    ]);
  });
});
