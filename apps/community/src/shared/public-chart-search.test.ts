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
