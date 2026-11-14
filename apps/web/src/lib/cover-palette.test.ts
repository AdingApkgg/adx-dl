import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import {
  contrastRatio,
  coverPaletteStyle,
  DEFAULT_COVER_PALETTE,
  paletteFromPixels,
} from "./cover-palette";

test("transparent artwork has a deterministic fallback", () => {
  expect(paletteFromPixels(new Uint8Array([255, 0, 0, 0]))).toEqual(DEFAULT_COVER_PALETTE);
});

test("a representative saturated colour wins over a white border", () => {
  const rgba = new Uint8Array([
    ...Array(70).fill([255, 255, 255, 255]).flat(),
    ...Array(30).fill([224, 32, 64, 255]).flat(),
  ]);
  const palette = paletteFromPixels(rgba);
  expect(parseInt(palette.accent.slice(1, 3), 16)).toBeGreaterThan(
    parseInt(palette.accent.slice(3, 5), 16) * 2,
  );
  expect(contrastRatio(palette.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.highlight, palette.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio("#252a34", palette.surface)).toBeGreaterThanOrEqual(7);
});

test("black and white covers still produce readable palettes", () => {
  for (const value of [0, 128, 255]) {
    const palette = paletteFromPixels(new Uint8Array([value, value, value, 255]));
    expect(contrastRatio(palette.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.highlight, palette.background)).toBeGreaterThanOrEqual(4.5);
  }
});

test("CSS colours reject malformed cached data and preserve only colour tokens", () => {
  expect(
    coverPaletteStyle({ ...DEFAULT_COVER_PALETTE, accent: "url(https://example.invalid)" }),
  ).toEqual(coverPaletteStyle());
  expect(Object.keys(coverPaletteStyle())).toHaveLength(5);
});

test("all generated cover palettes keep text and controls readable", () => {
  const cache = JSON.parse(
    readFileSync(new URL("../../../../data/catalog/cover-palettes.json", import.meta.url), "utf8"),
  );
  for (const value of Object.values(cache.entries) as { palette: typeof DEFAULT_COVER_PALETTE }[]) {
    expect(contrastRatio(value.palette.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(value.palette.highlight, value.palette.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio("#252a34", value.palette.surface)).toBeGreaterThanOrEqual(7);
  }
});
