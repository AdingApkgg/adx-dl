import { describe, expect, test } from "bun:test";

import {
  formatEntrySubcategory,
  type CatalogEntry,
} from "@/lib/catalog-shared";

function buildEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "song-1",
    remote_dir_name: "song-1",
    title: "曲目 1",
    title_en: "Song 1",
    artist: "歌手 1",
    artist_en: "Artist 1",
    category: "Official",
    subcategory: "BUDDiES",
    source_archive: "archive-1.adx",
    source_folder: "folder-1",
    version: "maimai DX BUDDiES",
    genre: "Anime",
    cabinet: "DX",
    short_id: "S1",
    bpm: 121,
    offset: null,
    download_mode: "mixed",
    download_url: "https://downloads.example.com/song-1.zip",
    source_url: "https://source.example.com/song-1",
    license_note: "license-1",
    files: {
      maidata: "maidata-1.txt",
      maidata_dx: "maidata-dx-1.txt",
      audio: "audio-1.mp3",
      background: "background-1.png",
      pv: "pv-1.mp4",
    },
    assets: {
      has_audio: true,
      has_background: true,
      has_pv: true,
      has_dx_chart: true,
    },
    media: {
      entry_base_url: "/catalog-assets/song-1",
      cover_url: "/catalog-assets/song-1/bg.jpg",
      audio_url: "/catalog-assets/song-1/track.mp3",
      pv_url: "/catalog-assets/song-1/pv.mp4",
    },
    difficulties: [{ slot: 0, level: "12+", designer: "Designer 1" }],
    imported_at: "2026-06-12T12:00:00.000Z",
    ...overrides,
  };
}

describe("catalog shared helpers", () => {
  test("keeps the original subcategory label for non-remote entries", () => {
    expect(formatEntrySubcategory(buildEntry())).toBe("BUDDiES");
  });

  test("prefers version and cabinet for remote entries", () => {
    expect(
      formatEntrySubcategory(
        buildEntry({
          category: "Remote",
          subcategory: "legacy-remote-subcategory",
          version: "maimai DX PRiSM",
          cabinet: "DX",
        })
      )
    ).toBe("maimai DX PRiSM / DX");
  });

  test("falls back to the source subcategory when remote version and cabinet are missing", () => {
    expect(
      formatEntrySubcategory(
        buildEntry({
          category: "Remote",
          subcategory: "maimai DX PRiSM / DX",
          version: "",
          cabinet: "",
        })
      )
    ).toBe("maimai DX PRiSM / DX");
  });
});
