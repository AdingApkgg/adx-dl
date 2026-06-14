import { describe, expect, test } from "bun:test";

import { entrySlug, toRouteSlug } from "./route-slug";

describe("entrySlug", () => {
  test("uses the readable catalog slug when present (incl. CJK)", () => {
    expect(entrySlug({ id: "e-1", slug: "1000年生きてる" })).toBe("1000年生きてる");
    expect(entrySlug({ id: "e-2", slug: "コネクト-dx" })).toBe("コネクト-dx");
    expect(entrySlug({ id: "e-3", slug: "starlight-disco-dx" })).toBe("starlight-disco-dx");
  });

  test("falls back to the FNV hash when slug is missing or blank", () => {
    expect(entrySlug({ id: "song-1" })).toBe(toRouteSlug("song-1"));
    expect(entrySlug({ id: "song-1", slug: "" })).toBe(toRouteSlug("song-1"));
    expect(entrySlug({ id: "song-1", slug: "   " })).toBe(toRouteSlug("song-1"));
    expect(entrySlug({ id: "song-1", slug: null })).toBe(toRouteSlug("song-1"));
  });
});
