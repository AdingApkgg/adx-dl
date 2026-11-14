import { expect, test } from "bun:test";
import type { CatalogEntry } from "./catalog-shared";
import { DEFAULT_COVER_PALETTE } from "./cover-palette";
import {
  cachedPaletteForEntry,
  paletteFingerprint,
  paletteSource,
  type CoverPaletteCache,
} from "./cover-palette-cache";
const entry = {
  id: "song",
  media: { cover_url: "https://example.test/bg.png", cover_webp: "https://example.test/bg.webp" },
  file_bytes: { background: 123 },
  imported_at: "2026-01-01",
} as CatalogEntry;
const cache: CoverPaletteCache = {
  version: 1,
  entries: {
    song: {
      source: paletteSource(entry),
      fingerprint: paletteFingerprint(entry),
      checkedAt: 1,
      palette: DEFAULT_COVER_PALETTE,
    },
  },
};
test("matching cache metadata applies palette while changed source/size cannot leak stale colours", () => {
  expect(cachedPaletteForEntry(entry, cache)).toEqual(DEFAULT_COVER_PALETTE);
  expect(
    cachedPaletteForEntry({ ...entry, file_bytes: { background: 124 } }, cache),
  ).toBeUndefined();
  expect(
    cachedPaletteForEntry(
      { ...entry, media: { ...entry.media, cover_webp: "https://example.test/new.webp" } },
      cache,
    ),
  ).toBeUndefined();
});
test("corrupt cache colour strings are rejected before reaching CSS", () => {
  expect(
    cachedPaletteForEntry(entry, {
      version: 1,
      entries: {
        song: { ...cache.entries.song, palette: { ...DEFAULT_COVER_PALETTE, accent: "red" } },
      },
    }),
  ).toBeUndefined();
});
