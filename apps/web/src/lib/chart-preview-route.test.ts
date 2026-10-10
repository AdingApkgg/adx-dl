import { expect, test } from "bun:test";
import { buildPreviewHref, legacyPreviewHref, readPreviewDifficulty } from "./chart-preview-route";

test("preview links use the canonical slug and localized route with a difficulty", () => {
  const entry = { id: "legacy-id", slug: "11805" };
  expect(buildPreviewHref(entry, "zh")).toBe("/preview/11805");
  expect(buildPreviewHref(entry, "en", 4)).toBe("/en/preview/11805?diff=4");
  expect(buildPreviewHref({ id: "a/b" }, "ja")).toBe("/ja/preview/a%2Fb");
});

test("legacy links retain beat and difficulty and replace the overlay flag", () => {
  const current = new URL("https://example.test/en/charts/old?preview=1&diff=4&beat=12.50&utm_source=share#position");
  expect(legacyPreviewHref(current, { id: "11805" }, "en")).toBe("/en/preview/11805?diff=4&beat=12.50&utm_source=share#position");
  expect(current.searchParams.get("preview")).toBe("1");
});

test("empty, negative and malformed difficulty links use the default", () => {
  for (const value of ["", "-1", "NaN", "4.5"]) expect(readPreviewDifficulty(new URLSearchParams({ diff: value }))).toBeNull();
  expect(readPreviewDifficulty(new URLSearchParams("diff=4"))).toBe(4);
});
