import { describe, expect, test } from "bun:test";

import { hasStaleShellAssets, shellAssetKeys } from "./sw-shell";

// Shapes taken verbatim from a real export: everything under `_next/static` is
// content-hashed except the two buildId-scoped Next manifests.
const CHUNK = "/_next/static/chunks/7676-d93ca772b063c1c0.js";
const OTHER_CHUNK = "/_next/static/chunks/1492-27f85ce4c59a448e.js";
const CSS = "/_next/static/css/29ebf647099d3d96.css";
const FONT = "/_next/static/media/noto-sans-cyrillic-wght-normal.56471747.woff2";
const BUILD_MANIFEST = "/_next/static/hTClgJpAvJ0Wbb96jLvfV/_buildManifest.js";
const SSG_MANIFEST = "/_next/static/hTClgJpAvJ0Wbb96jLvfV/_ssgManifest.js";

describe("shellAssetKeys", () => {
  test("only covers the lazily-loaded app shell, not the rest of the precache", () => {
    // offline.html embeds the buildId, so its revision changes on every build.
    // Letting it in would reload every open tab on every deploy.
    expect(
      shellAssetKeys([
        CHUNK,
        CSS,
        { url: "/offline.html", revision: "9f1c" },
        { url: "/site.webmanifest", revision: "aa02" },
        { url: "/icon-512.png", revision: "b731" },
      ])
    ).toEqual(shellAssetKeys([CHUNK, CSS]));
  });

  test("ignores the buildId-scoped Next manifests", () => {
    expect(shellAssetKeys([CHUNK, CSS, BUILD_MANIFEST, SSG_MANIFEST])).toEqual(
      shellAssetKeys([
        CHUNK,
        CSS,
        "/_next/static/Zq7XkP2mNr4tVb8yLs1Ec/_buildManifest.js",
        "/_next/static/Zq7XkP2mNr4tVb8yLs1Ec/_ssgManifest.js",
      ])
    );
  });

  test("does not depend on manifest order", () => {
    expect(shellAssetKeys([CHUNK, CSS, FONT])).toEqual(shellAssetKeys([FONT, CHUNK, CSS]));
  });

  test("treats bare strings and revisioned entries alike", () => {
    expect(shellAssetKeys([{ url: CHUNK }])).toEqual(shellAssetKeys([CHUNK]));
    expect(shellAssetKeys([{ url: CHUNK, revision: null }])).toEqual(shellAssetKeys([CHUNK]));
    expect(shellAssetKeys([{ url: CHUNK, revision: "1" }])).not.toEqual(shellAssetKeys([CHUNK]));
  });

  test("falls back to the whole manifest when nothing looks like a Next asset", () => {
    // Keys that can never change would strand open tabs on a build whose chunks
    // are gone from the origin — fail towards reloading, not towards silence.
    expect(shellAssetKeys([{ url: "/app.js", revision: "aaa" }])).not.toEqual([]);
  });

  test("is empty for an empty manifest", () => {
    expect(shellAssetKeys([])).toEqual([]);
    expect(shellAssetKeys()).toEqual([]);
  });
});

describe("hasStaleShellAssets", () => {
  const before = shellAssetKeys([CHUNK, CSS]);

  test("an unchanged shell needs no reload", () => {
    expect(hasStaleShellAssets(before, shellAssetKeys([CHUNK, CSS]))).toBe(false);
  });

  test("a build that only adds assets needs no reload", () => {
    // Nothing in the old build's dependency graph was removed, so a tab running
    // it can still lazy-load everything it knows about.
    expect(hasStaleShellAssets(before, shellAssetKeys([CHUNK, CSS, OTHER_CHUNK]))).toBe(false);
  });

  test("a changed content hash needs a reload", () => {
    const after = shellAssetKeys(["/_next/static/chunks/7676-0000000000000000.js", CSS]);

    expect(hasStaleShellAssets(before, after)).toBe(true);
  });

  test("a removed asset needs a reload", () => {
    expect(hasStaleShellAssets(before, shellAssetKeys([CHUNK]))).toBe(true);
  });

  test("a rebuild that only rotates the buildId needs no reload", () => {
    // The daily featured-rotation deploy in CI: same code, new buildId, new
    // offline.html revision, identical chunks.
    const daily = shellAssetKeys([CHUNK, CSS, BUILD_MANIFEST, { url: "/offline.html", revision: "1" }]);
    const nextDay = shellAssetKeys([
      CHUNK,
      CSS,
      "/_next/static/Zq7XkP2mNr4tVb8yLs1Ec/_buildManifest.js",
      { url: "/offline.html", revision: "2" },
    ]);

    expect(hasStaleShellAssets(daily, nextDay)).toBe(false);
  });

  test("an empty previous list needs no reload", () => {
    expect(hasStaleShellAssets([], before)).toBe(false);
  });
});
