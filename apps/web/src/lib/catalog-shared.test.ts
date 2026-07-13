import { describe, expect, test } from "bun:test";

import {
  collectDifficultyLevels,
  difficultyDisplayLevel,
  entryHasLevel,
  formatEntrySubcategory,
  getChartAssetFiles,
  getChartDownloadSpec,
  toCatalogCardEntry,
  versionFolderName,
  versionGroupFolderName,
  versionShortName,
  type CatalogEntry,
} from "@/lib/catalog-shared";

function buildEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "song-1",
    slug: "11951",
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
    short_id: "11951",
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
      entry_base_url: "/covers/song-1",
      cover_url: "/covers/song-1/bg.jpg",
      audio_url: "/covers/song-1/track.mp3",
      pv_url: "/covers/song-1/pv.mp4",
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

  test("getChartAssetFiles maps the AstroDX asset names and can drop the video", () => {
    const entry = buildEntry();

    expect(getChartAssetFiles(entry)).toEqual([
      // maidata stays same-origin (local mirror); bg.png/audio/pv come from R2.
      { name: "maidata.txt", url: "/adxcs/11951/maidata.txt" },
      { name: "track.mp3", url: "/covers/song-1/track.mp3" },
      { name: "bg.png", url: "/covers/song-1/bg.jpg" },
      { name: "pv.mp4", url: "/covers/song-1/pv.mp4" },
    ]);

    expect(getChartAssetFiles(entry, { includeVideo: false }).map((file) => file.name)).toEqual([
      "maidata.txt",
      "track.mp3",
      "bg.png",
    ]);

    // Missing assets (empty url) are skipped.
    const noAudio = buildEntry({
      media: { ...buildEntry().media, audio_url: "" },
    });
    expect(getChartAssetFiles(noAudio).map((file) => file.name)).toEqual([
      "maidata.txt",
      "bg.png",
      "pv.mp4",
    ]);
  });

  test("getChartDownloadSpec carries the global version folder", () => {
    expect(getChartDownloadSpec(buildEntry({ remote_dir_name: "11951" }))).toEqual({
      dir: "11951",
      files: [
        { name: "maidata.txt", url: "/adxcs/11951/maidata.txt" },
        { name: "track.mp3", url: "/covers/song-1/track.mp3" },
        { name: "bg.png", url: "/covers/song-1/bg.jpg" },
        { name: "pv.mp4", url: "/covers/song-1/pv.mp4" },
      ],
      groupDir: "21 BUDDiES",
    });

    expect(versionGroupFolderName("maimai DX CiRCLE")).toBe("25 CiRCLE");
    expect(versionGroupFolderName("unmapped version", "未知版本")).toBe("未知版本");
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

  test("versionFolderName keeps the agreed download folder names", () => {
    const expected: [string, string, string][] = [
      ["maimai", "maimai", "00 maimai"],
      ["maimai PLUS", "PLUS", "01 PLUS"],
      ["maimai GreeN", "GreeN", "02 GreeN"],
      ["maimai GreeN PLUS", "GreeN PLUS", "03 GreeN PLUS"],
      ["maimai ORANGE", "ORANGE", "04 ORANGE"],
      ["maimai ORANGE PLUS", "ORANGE PLUS", "05 ORANGE PLUS"],
      ["maimai PiNK", "PiNK", "06 PiNK"],
      ["maimai PiNK PLUS", "PiNK PLUS", "07 PiNK PLUS"],
      ["maimai MURASAKi", "MURASAKi", "08 MURASAKi"],
      ["maimai MURASAKi PLUS", "MURASAKi PLUS", "09 MURASAKi PLUS"],
      ["maimai MiLK", "MiLK", "10 MiLK"],
      ["maimai MiLK PLUS", "MiLK PLUS", "11 MiLK PLUS"],
      ["maimai FiNALE", "FiNALE", "12 FiNALE"],
      ["maimai DX", "DX", "13 DX"],
      ["maimai DX PLUS", "DX PLUS", "14 DX PLUS"],
      ["maimai DX Splash", "Splash", "15 Splash"],
      ["maimai DX Splash PLUS", "Splash PLUS", "16 Splash PLUS"],
      ["maimai DX UNiVERSE", "UNiVERSE", "17 UNiVERSE"],
      ["maimai DX UNiVERSE PLUS", "UNiVERSE PLUS", "18 UNiVERSE PLUS"],
      ["maimai DX FESTiVAL", "FESTiVAL", "19 FESTiVAL"],
      ["maimai DX FESTiVAL PLUS", "FESTiVAL PLUS", "20 FESTiVAL PLUS"],
      ["maimai DX BUDDiES", "BUDDiES", "21 BUDDiES"],
      ["maimai DX BUDDiES PLUS", "BUDDiES PLUS", "22 BUDDiES PLUS"],
      ["maimai DX PRiSM", "PRiSM", "23 PRiSM"],
      ["maimai DX PRiSM PLUS", "PRiSM PLUS", "24 PRiSM PLUS"],
      ["maimai DX CiRCLE", "CiRCLE", "25 CiRCLE"],
      ["maimai DX CiRCLE PLUS", "CiRCLE PLUS", "26 CiRCLE PLUS"],
    ];

    for (const [source, shortName, folder] of expected) {
      expect(versionFolderName(source)).toBe(folder);
      expect(versionShortName(source)).toBe(shortName);
    }
  });

  test("toCatalogCardEntry keeps card fields and drops the heavy download payload", () => {
    const card = toCatalogCardEntry(buildEntry({ aliases: ["曲一"], genreid: 103 }));

    expect(card.title).toBe("曲目 1");
    expect(card.aliases).toEqual(["曲一"]);
    expect(card.genreid).toBe(103);
    expect(card.difficulties).toEqual([{ slot: 0, level: "12+", designer: "Designer 1" }]);
    // Only the cover trio survives from media; file specs and URLs are gone.
    expect(card.media).toEqual({ cover_url: "/covers/song-1/bg.jpg" });
    expect("files" in card).toBe(false);
    expect("download_url" in card).toBe(false);
    expect("license_note" in card).toBe(false);
    expect("remote_dir_name" in card).toBe(false);
    // Empty optional fields are omitted entirely (payload bytes matter here).
    expect("aliases" in toCatalogCardEntry(buildEntry())).toBe(false);
  });

  test("difficultyDisplayLevel groups chart constants into player-facing levels", () => {
    expect(difficultyDisplayLevel("13.4")).toBe("13");
    expect(difficultyDisplayLevel("13.6")).toBe("13+");
    expect(difficultyDisplayLevel("13.9")).toBe("13+");
    expect(difficultyDisplayLevel("13+?")).toBe("13+");
    expect(difficultyDisplayLevel("12?")).toBe("12");
    expect(difficultyDisplayLevel("15.0")).toBe("15");
    // Official "+" tiers only exist from level 7 up.
    expect(difficultyDisplayLevel("6.8")).toBe("6");
    expect(difficultyDisplayLevel("宴")).toBeNull();
    expect(difficultyDisplayLevel(" ")).toBeNull();
  });

  test("collectDifficultyLevels dedupes into display levels sorted in play order", () => {
    const entries = [
      buildEntry({
        difficulties: [
          { slot: 5, level: "13.0", designer: "" },
          { slot: 4, level: "12+", designer: "" },
        ],
      }),
      buildEntry({
        difficulties: [
          { slot: 2, level: "12.3", designer: "" },
          { slot: 3, level: "12.8", designer: "" },
          { slot: 7, level: " ", designer: "" },
        ],
      }),
    ];

    expect(collectDifficultyLevels(entries)).toEqual(["12", "12+", "13"]);
  });

  test("entryHasLevel matches when any difficulty displays as the level", () => {
    const entry = buildEntry({
      difficulties: [
        { slot: 4, level: "12.7", designer: "" },
        { slot: 5, level: "13.2", designer: "" },
      ],
    });

    expect(entryHasLevel(entry, "13")).toBe(true);
    expect(entryHasLevel(entry, "12+")).toBe(true);
    expect(entryHasLevel(entry, "12")).toBe(false);
  });
});
