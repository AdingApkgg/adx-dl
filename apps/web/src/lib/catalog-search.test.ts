import { describe, expect, test } from "bun:test";

import type { CatalogEntry } from "@/lib/catalog-shared";
import {
  ALL_CATEGORIES,
  ALL_SUBCATEGORIES,
  applyCatalogFilters,
  buildCatalogSearch,
  getCategoryOptions,
  getSubcategoryOptions,
} from "./catalog-search";

function buildEntry(overrides: Partial<CatalogEntry>): CatalogEntry {
  return {
    id: "official-alpha",
    remote_dir_name: "official-alpha",
    title: "Alpha Star",
    title_en: "Alpha Star",
    artist: "星野",
    artist_en: "Hoshino",
    category: "Official",
    subcategory: "DX 2025",
    source_archive: "archive.adx",
    source_folder: "folder",
    version: "Ver.1",
    genre: "Game",
    cabinet: "DX",
    short_id: "A1",
    bpm: 180,
    offset: null,
    download_mode: "mixed",
    download_url: "https://downloads.example.com/official-alpha.zip",
    source_url: "https://source.example.com/official-alpha",
    license_note: "license",
    files: {
      maidata: "maidata.txt",
      maidata_dx: "maidata_dx.txt",
      audio: "audio.mp3",
      background: "background.jpg",
      pv: "pv.mp4",
    },
    assets: {
      has_audio: true,
      has_background: true,
      has_pv: true,
      has_dx_chart: true,
    },
    media: {
      entry_base_url: "/covers/official-alpha",
      cover_url: "/covers/official-alpha/bg.jpg",
      audio_url: "/covers/official-alpha/track.mp3",
      pv_url: "/covers/official-alpha/pv.mp4",
    },
    difficulties: [{ slot: 0, level: "12+", designer: "Designer A" }],
    imported_at: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("catalog-search", () => {
  const entries = [
    buildEntry({}),
    buildEntry({
      id: "community-beta",
      title: "Midnight Echo",
      title_en: "Midnight Echo",
      artist: "Alpha Crew",
      artist_en: "Alpha Crew",
      category: "Community",
      subcategory: "Touhou",
    }),
    buildEntry({
      id: "official-gamma",
      title: "月光列车",
      title_en: "Moonlight Train",
      artist: "夜色",
      artist_en: "Nighttone",
      category: "Official",
      subcategory: "DX 2024",
    }),
  ];

  test("标题命中优先于仅艺人命中，并且默认跨所有分类搜索", () => {
    const search = buildCatalogSearch(entries);
    const results = search("alpha");

    expect(results.map((entry) => entry.id)).toEqual([
      "official-alpha",
      "community-beta",
    ]);
  });

  test("支持英文标题和英文艺人字段", () => {
    const search = buildCatalogSearch(entries);

    expect(search("moonlight").map((entry) => entry.id)).toEqual(["official-gamma"]);
    expect(search("nighttone").map((entry) => entry.id)).toEqual(["official-gamma"]);
  });

  test("空查询返回原始顺序，分类和子分类作为二次筛选", () => {
    const search = buildCatalogSearch(entries);
    const browseEntries = search("   ");

    expect(browseEntries.map((entry) => entry.id)).toEqual([
      "official-alpha",
      "community-beta",
      "official-gamma",
    ]);

    expect(
      applyCatalogFilters(search("alpha"), "Community", ALL_SUBCATEGORIES).map((entry) => entry.id)
    ).toEqual(["community-beta"]);

    expect(
      applyCatalogFilters(search("moonlight"), "Official", "DX 2024").map((entry) => entry.id)
    ).toEqual(["official-gamma"]);
  });

  test("分类和子分类选项包含 all 作用域", () => {
    expect(getCategoryOptions(entries)).toEqual([ALL_CATEGORIES, "Community", "Official"]);
    expect(getSubcategoryOptions(entries, ALL_CATEGORIES)).toEqual([
      ALL_SUBCATEGORIES,
      "DX 2024",
      "DX 2025",
      "Touhou",
    ]);
    expect(getSubcategoryOptions(entries, "Official")).toEqual([
      ALL_SUBCATEGORIES,
      "DX 2024",
      "DX 2025",
    ]);
  });
});
