import { describe, expect, test } from "bun:test";
import { invertCatalogSelection } from "./catalog-selection";
import { matchesVersionFilter, parseVersionFilterMode } from "./catalog-version-filter";

describe("version exclusion", () => {
  const versions = ["0", "23", "24", "25", "26", "unknown"];
  const selected = new Set(["24", "25", "26"]);

  test("switching mode complements the result while keeping chosen versions", () => {
    expect(versions.filter((id) => matchesVersionFilter(id, selected, "include"))).toEqual(["24", "25", "26"]);
    expect(versions.filter((id) => matchesVersionFilter(id, selected, "exclude"))).toEqual(["0", "23", "unknown"]);
    expect([...selected]).toEqual(["24", "25", "26"]);
  });

  test("empty selections show all versions in either mode", () => {
    for (const mode of ["include", "exclude"] as const) {
      expect(versions.filter((id) => matchesVersionFilter(id, new Set(), mode))).toEqual(versions);
    }
  });

  test("excluding all known versions retains unknown and future versions", () => {
    const known = new Set(versions.filter((id) => id !== "unknown"));
    expect([...versions, "27"].filter((id) => matchesVersionFilter(id, known, "exclude"))).toEqual(["unknown", "27"]);
    expect(versions.filter((id) => matchesVersionFilter(id, new Set(versions), "exclude"))).toEqual([]);
  });

  test("other dimensions intersect with exclusions and result inversion preserves outside selections", () => {
    const charts = [
      { id: "old-game", version: "23", genre: "game" },
      { id: "old-pop", version: "23", genre: "pop" },
      { id: "new-game", version: "24", genre: "game" },
      { id: "unknown-game", version: "unknown", genre: "game" },
    ];
    const results = charts.filter((chart) => chart.genre === "game" && matchesVersionFilter(chart.version, selected, "exclude")).map((chart) => chart.id);
    expect(results).toEqual(["old-game", "unknown-game"]);
    expect([...invertCatalogSelection(new Set(["old-game", "new-game"]), results)]).toEqual(["new-game", "unknown-game"]);
  });

  test("old links include selected versions; invalid mode values cannot enable exclusion", () => {
    expect(parseVersionFilterMode(null)).toBe("include");
    expect(parseVersionFilterMode("include")).toBe("include");
    expect(parseVersionFilterMode("exclude")).toBe("exclude");
    expect(parseVersionFilterMode("EXCLUDE")).toBe("include");
    expect(parseVersionFilterMode("invalid")).toBe("include");
  });
});
