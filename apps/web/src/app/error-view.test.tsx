import { describe, expect, test } from "bun:test";

import { isChunkLoadError } from "./error-view";

/**
 * The classifier decides whether the boundary silently reloads or shows the
 * user a dead end, so both directions matter: a missed chunk error strands a
 * tab that one reload would have fixed, and a false positive turns a real bug
 * into a reload that changes nothing.
 */
describe("isChunkLoadError", () => {
  test("matches the webpack/Turbopack ChunkLoadError name", () => {
    const error = new Error("Loading chunk 42 failed.");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  test("matches chunk failures reported only through the message", () => {
    for (const message of [
      "Loading chunk 9341 failed. (missing: /_next/static/chunks/9341.js)",
      "Loading CSS chunk 12 failed.",
      "Failed to fetch dynamically imported module: /_next/static/chunks/x.js",
      "error loading dynamically imported module",
    ]) {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    }
  });

  test("leaves ordinary application errors alone", () => {
    for (const message of [
      "Cannot read properties of undefined (reading 'slug')",
      "slugs.json responded 404",
      "Directory is empty",
    ]) {
      expect(isChunkLoadError(new Error(message))).toBe(false);
    }
  });
});
