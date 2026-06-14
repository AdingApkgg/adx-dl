import { describe, expect, test } from "bun:test";

import { entrySlug } from "./route-slug";

describe("entrySlug", () => {
  test("uses the catalog slug (shortid) when present", () => {
    expect(entrySlug({ id: "x", slug: "11630" })).toBe("11630");
    expect(entrySlug({ id: "x", slug: "10146" })).toBe("10146");
  });

  test("falls back to the id when slug is missing or blank", () => {
    expect(entrySlug({ id: "song-1" })).toBe("song-1");
    expect(entrySlug({ id: "song-1", slug: "" })).toBe("song-1");
    expect(entrySlug({ id: "song-1", slug: "   " })).toBe("song-1");
    expect(entrySlug({ id: "song-1", slug: null })).toBe("song-1");
  });
});
