import { expect, test } from "bun:test";
import { parsePublicChartFilters, publicChartFiltersFromParams, publicChartSearchParams } from "./public-chart-search";

test("Unicode and literal wildcard characters roundtrip without losing numeric bigint identities", () => {
  const filters = parsePublicChartFilters({ q: "  星 / テスト %_🦀  ", difficulty: "7", sort: "published", author: "9223372036854775807" });
  expect(filters.q).toBe("星 / テスト %_🦀");
  expect(publicChartFiltersFromParams(publicChartSearchParams(filters))).toEqual(filters);
});
test("filters reject invalid difficulty, sort, identity and oversized queries", () => {
  for (const input of [{ difficulty: "0" }, { difficulty: "4.0" }, { sort: "popular" }, { author: "01" },
    { author: "9223372036854775808" }, { q: "a".repeat(121) }, { q: "x\u0000" }]) {
    expect(() => parsePublicChartFilters(input)).toThrow(RangeError);
  }
  expect(parsePublicChartFilters({ q: "🦀".repeat(120) }).q).toHaveLength(240);
});

test("one normalized public tag roundtrips and invalid tags never become cursor scope", () => {
  const filters = parsePublicChartFilters({ tag: " ＡＢＣ ", q: "Designer", difficulty: "4" });
  expect(filters.tag).toBe("abc");
  expect(publicChartFiltersFromParams(publicChartSearchParams(filters))).toEqual(filters);
  for (const tag of ["a/b", "https:example", "a\u0000", "a".repeat(21)]) expect(() => parsePublicChartFilters({ tag })).toThrow(RangeError);
});
