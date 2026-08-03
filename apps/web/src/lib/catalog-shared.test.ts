import { describe, expect, test } from "bun:test";

import {
  buildLevelGradient,
  cabinetBucket,
  clampRange,
  collectDifficultyLevels,
  DIFFICULTY_TONE_COLOR,
  difficultyDisplayLevel,
  entryHasLevelInRange,
  formatRangeParam,
  isFullRange,
  levelDisplayTone,
  parseBpmParam,
  parseLevelParam,
  difficultyDisplayLevels,
  formatEntrySubcategory,
  genreFilterQuery,
  genreGroupFolderName,
  getChartAssetFiles,
  getChartDownloadSpec,
  isKnownVersionIndex,
  normalizeCabinetId,
  resolveVersionIndex,
  toCatalogCardEntry,
  UTAGE_GENRE_ID,
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
  test("resolves stable version ids with a canonical-name fallback", () => {
    expect(isKnownVersionIndex(24)).toBe(true);
    expect(isKnownVersionIndex(27)).toBe(false);
    expect(resolveVersionIndex(buildEntry({ versionid: 24, version: "stale-name" }))).toBe(24);
    expect(resolveVersionIndex(buildEntry({ versionid: 999, version: "maimai DX PRiSM" }))).toBe(23);
    expect(resolveVersionIndex(buildEntry({ versionid: undefined, version: "unmapped" }))).toBeNull();
  });

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

  test("getChartDownloadSpec carries the version and genre grouping folders", () => {
    expect(getChartDownloadSpec(buildEntry({ remote_dir_name: "11951" }))).toEqual({
      dir: "11951",
      files: [
        { name: "maidata.txt", url: "/adxcs/11951/maidata.txt" },
        { name: "track.mp3", url: "/covers/song-1/track.mp3" },
        { name: "bg.png", url: "/covers/song-1/bg.jpg" },
        { name: "pv.mp4", url: "/covers/song-1/pv.mp4" },
      ],
      groupDir: "21 BUDDiES",
      genreDir: "Anime",
    });

    expect(versionGroupFolderName("maimai DX CiRCLE")).toBe("25 CiRCLE");
    expect(versionGroupFolderName("unmapped version", "未知版本")).toBe("未知版本");
  });

  test("genreGroupFolderName uses the canonical JP genre name", () => {
    // genreid wins and maps to the canonical in-game name.
    expect(genreGroupFolderName({ genreid: 103, genre: "whatever" })).toBe("東方Project");
    // The stable JP genre string resolves even without a genreid.
    expect(genreGroupFolderName({ genre: "POPS＆アニメ" })).toBe("POPS＆アニメ");
    // Unmapped genres fall back to the raw string with path separators defused.
    expect(genreGroupFolderName({ genre: "A/B\\C" })).toBe("A／B／C");
    // Nothing to go on → the unknown bucket.
    expect(genreGroupFolderName({})).toBe("Unknown");
    expect(genreGroupFolderName({ genre: "  " }, "未知曲风")).toBe("未知曲风");
  });

  test("genreFilterQuery routes 宴会場 to the cabinet filter", () => {
    // Ordinary genres filter from the genre row.
    expect(genreFilterQuery(103)).toBe("genre=103");
    expect(genreFilterQuery(101)).toBe("genre=101");
    // 宴会場 has no genre chip — the Type row's UTAGE chip is the same filter, so
    // a genre=107 link would highlight nothing in the panel.
    expect(genreFilterQuery(UTAGE_GENRE_ID)).toBe("cabinet=UTAGE");
    expect(genreFilterQuery(107)).toBe("cabinet=UTAGE");
  });

  test("level ranges match on the sort order, not the string", () => {
    const entry = buildEntry({
      difficulties: [
        { slot: 4, level: "11.2", designer: "" },
        { slot: 5, level: "12.8", designer: "" },
      ],
    });
    // 11.2 displays as "11", 12.8 as "12+".
    expect(entryHasLevelInRange(entry, "11", "12+")).toBe(true);
    expect(entryHasLevelInRange(entry, "12+", "13")).toBe(true);
    expect(entryHasLevelInRange(entry, "13", "15")).toBe(false);
    expect(entryHasLevelInRange(entry, "1", "10+")).toBe(false);
    // "12+" sits between 12 and 13 — a plain string compare would sort it after.
    expect(entryHasLevelInRange(entry, "12", "12+")).toBe(true);
    expect(entryHasLevelInRange(entry, "12", "12")).toBe(false);
  });

  test("level param reads ranges and the chip-list form it replaced", () => {
    const scale = ["1", "7", "7+", "12", "12+", "13"];
    expect(parseLevelParam("7-12+", scale)).toEqual([1, 4]);
    // A legacy list collapses to its span — a range cannot express a gap.
    expect(parseLevelParam("7,13", scale)).toEqual([1, 5]);
    expect(parseLevelParam("12+", scale)).toEqual([4, 4]);
    // Reversed ends are ordered.
    expect(parseLevelParam("13-7", scale)).toEqual([1, 5]);
    // A range with an unreadable end is discarded whole rather than half-applied
    // — "7-99" must not silently become "just level 7", a filter nobody asked for.
    expect(parseLevelParam("99", scale)).toBeNull();
    expect(parseLevelParam("7-99", scale)).toBeNull();
    expect(parseLevelParam("7-12+", [])).toBeNull();
  });

  test("bpm param reads ranges and the legacy bucket ids", () => {
    const bounds = [60, 300] as const;
    expect(parseBpmParam("120-200", bounds)).toEqual([120, 200]);
    // Detail pages linked ?bpm=<bucket id>; bucket 1 is 121–160.
    expect(parseBpmParam("1", bounds)).toEqual([121, 160]);
    expect(parseBpmParam("1,2", bounds)).toEqual([121, 200]);
    // The top bucket is open-ended and gets capped at the catalog's fastest.
    expect(parseBpmParam("3", bounds)).toEqual([201, 300]);
    // Out-of-bounds ends clamp rather than filtering to nothing.
    expect(parseBpmParam("0-9999", bounds)).toEqual([60, 300]);
    expect(parseBpmParam("nonsense", bounds)).toBeNull();
  });

  test("a full-span range counts as no filter", () => {
    expect(isFullRange([0, 5], [0, 5])).toBe(true);
    expect(isFullRange([0, 4], [0, 5])).toBe(false);
    expect(isFullRange([1, 5], [0, 5])).toBe(false);
    expect(formatRangeParam([120, 200])).toBe("120-200");
    expect(clampRange([200, 120], [0, 300])).toEqual([120, 200]);
  });

  test("the level gradient stops on each level's difficulty colour", () => {
    expect(levelDisplayTone("3")).toBe("basic");
    expect(levelDisplayTone("7+")).toBe("advanced");
    expect(levelDisplayTone("11")).toBe("expert");
    expect(levelDisplayTone("13+")).toBe("master");
    expect(levelDisplayTone("15")).toBe("remaster");

    const gradient = buildLevelGradient(["1", "8", "15"]);
    expect(gradient).toContain(DIFFICULTY_TONE_COLOR.basic + " 0.00%");
    expect(gradient).toContain(DIFFICULTY_TONE_COLOR.advanced + " 50.00%");
    expect(gradient).toContain(DIFFICULTY_TONE_COLOR.remaster + " 100.00%");
    // Degenerate scales still yield a usable gradient rather than NaN stops.
    expect(buildLevelGradient([])).not.toContain("NaN");
    expect(buildLevelGradient(["12"])).not.toContain("NaN");
  });

  test("cabinet buckets group the real cabinet strings, legacy ids still resolve", () => {
    // The catalog stores DX/ST or a 宴 kanji; every kanji is one UTAGE bucket.
    expect(cabinetBucket("DX")).toBe("DX");
    expect(cabinetBucket("ST")).toBe("ST");
    expect(cabinetBucket("協")).toBe("UTAGE");
    expect(cabinetBucket("蔵")).toBe("UTAGE");
    expect(cabinetBucket("")).toBe("UTAGE");

    expect(normalizeCabinetId("UTAGE")).toBe("UTAGE");
    // The bucket was called UTG until it was renamed; shared links still say so.
    expect(normalizeCabinetId("UTG")).toBe("UTAGE");
    expect(normalizeCabinetId(" DX ")).toBe("DX");
    expect(normalizeCabinetId("SD")).toBeNull();
    expect(normalizeCabinetId("")).toBeNull();
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

  test("an unverified UTAGE level covers its whole level, both tiers", () => {
    // A constant maps to exactly one display level.
    expect(difficultyDisplayLevels("13.4")).toEqual(["13"]);
    expect(difficultyDisplayLevels("13.7")).toEqual(["13+"]);
    // "13?" has no constant behind it — it is somewhere in level 13, so it
    // occupies the level whole and answers a filter for either tier.
    expect(difficultyDisplayLevels("13?")).toEqual(["13", "13+"]);
    // Already committed to the upper tier — stays single.
    expect(difficultyDisplayLevels("13+?")).toEqual(["13+"]);
    // No official 15+ / 6+ tier exists, so those span nothing extra.
    expect(difficultyDisplayLevels("15?")).toEqual(["15"]);
    expect(difficultyDisplayLevels("6?")).toEqual(["6"]);
    expect(difficultyDisplayLevels("")).toEqual([]);
  });

  test("a 13? UTAGE chart is found by both the 13 and the 13+ range", () => {
    const utage = buildEntry({
      cabinet: "協",
      difficulties: [{ slot: 7, level: "13?", designer: "" }],
    });

    expect(entryHasLevelInRange(utage, "13", "13")).toBe(true);
    expect(entryHasLevelInRange(utage, "13+", "13+")).toBe(true);
    expect(entryHasLevelInRange(utage, "12+", "13")).toBe(true);
    expect(entryHasLevelInRange(utage, "13+", "14")).toBe(true);
    // But not levels it cannot be: 12 and below, 14 and above.
    expect(entryHasLevelInRange(utage, "1", "12+")).toBe(false);
    expect(entryHasLevelInRange(utage, "14", "15")).toBe(false);

    // An exact constant still matches only its own tier.
    const normal = buildEntry({
      difficulties: [{ slot: 5, level: "13.4", designer: "" }],
    });
    expect(entryHasLevelInRange(normal, "13", "13")).toBe(true);
    expect(entryHasLevelInRange(normal, "13+", "13+")).toBe(false);
  });

  test("the level scale includes both tiers an unverified level spans", () => {
    expect(
      collectDifficultyLevels([
        { difficulties: [{ slot: 7, level: "13?", designer: "" }] },
        { difficulties: [{ slot: 7, level: "15?", designer: "" }] },
      ])
    ).toEqual(["13", "13+", "15"]);
  });
});
