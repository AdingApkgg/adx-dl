import { describe, expect, test } from "bun:test";

import { CONTENT_FILES, findContentFile, validateContentFile } from "./registry";

describe("CONTENT_FILES", () => {
  test("keys are unique", () => {
    const keys = CONTENT_FILES.map((file) => file.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("paths are unique and live under apps/web/content/", () => {
    const paths = CONTENT_FILES.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith("apps/web/content/")).toBe(true);
      expect(path.endsWith(".json")).toBe(true);
    }
  });

  test("every file declares at least one array", () => {
    for (const file of CONTENT_FILES) {
      expect(file.arrays.length).toBeGreaterThan(0);
    }
  });
});

describe("validateContentFile", () => {
  test("an unknown key is an error, not a crash", () => {
    expect(validateContentFile("nope", {})).toEqual({
      ok: false,
      errors: ["未知的内容键：nope"],
    });
  });

  test("dispatches to the right spec", () => {
    // donate's only array is `methods`; passing community's shape must fail.
    expect(validateContentFile("donate", { contactChannels: [] })).toMatchObject({ ok: false });
  });

  test("findContentFile round-trips every key", () => {
    for (const file of CONTENT_FILES) {
      expect(findContentFile(file.key)).toBe(file);
    }
  });
});
