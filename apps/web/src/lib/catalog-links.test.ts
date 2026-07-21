import { describe, expect, test } from "bun:test";

import { buildVersionFilterHref } from "@/lib/catalog-links";

describe("catalog filter links", () => {
  test("builds stable version-id filters with the active locale prefix", () => {
    expect(buildVersionFilterHref(24, "zh")).toBe("/charts?version=24");
    expect(buildVersionFilterHref(24, "en")).toBe("/en/charts?version=24");
    expect(buildVersionFilterHref(24, "ja")).toBe("/ja/charts?version=24");
    expect(buildVersionFilterHref(null, "zh")).toBe("/charts?version=unknown");
  });
});
