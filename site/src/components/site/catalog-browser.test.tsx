import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CatalogEntry } from "@/lib/catalog-shared";
import { CatalogBrowser } from "./catalog-browser";

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
      entry_base_url: "/catalog-assets/official-alpha",
      cover_url: "/catalog-assets/official-alpha/bg.jpg",
      audio_url: "/catalog-assets/official-alpha/track.mp3",
      pv_url: "/catalog-assets/official-alpha/pv.mp4",
    },
    difficulties: [{ slot: 0, level: "12+", designer: "Designer A" }],
    imported_at: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("CatalogBrowser", () => {
  test("renders localized search controls with all-category scope", () => {
    const html = renderToStaticMarkup(
      <CatalogBrowser
        entries={[
          buildEntry({}),
          buildEntry({
            id: "community-beta",
            title: "Midnight Echo",
            artist: "Alpha Crew",
            artist_en: "Alpha Crew",
            category: "Community",
            subcategory: "Touhou",
          }),
        ]}
        locale="en"
        detailPathPrefix="/charts"
      />
    );

    expect(html).toContain("All Categories");
    expect(html).toContain("All Subcategories");
    expect(html).toContain("Search title, artist, version...");
  });

  test("renders localized pagination labels when result set spans multiple pages", () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      buildEntry({
        id: `official-${index}`,
        title: `Alpha ${index}`,
        title_en: `Alpha ${index}`,
      })
    );

    const html = renderToStaticMarkup(
      <CatalogBrowser entries={entries} locale="en" detailPathPrefix="/charts" />
    );

    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("Showing 1-24 of 25");
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
  });

  test("renders only the first page of entries when pagination is active", () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      buildEntry({
        id: `official-${index}`,
        title: `Alpha ${index}`,
        title_en: `Alpha ${index}`,
        artist: `Artist ${index}`,
        artist_en: `Artist ${index}`,
      })
    );

    const html = renderToStaticMarkup(
      <CatalogBrowser entries={entries} locale="en" detailPathPrefix="/charts" />
    );

    expect(html).toContain("Alpha 0");
    expect(html).toContain("Alpha 23");
    expect(html).not.toContain("Alpha 24");
  });

  test("renders entries in a card-grid layout instead of the legacy dense row list", () => {
    const html = renderToStaticMarkup(
      <CatalogBrowser
        entries={[
          buildEntry({}),
          buildEntry({
            id: "community-beta",
            title: "Midnight Echo",
            artist: "Alpha Crew",
            artist_en: "Alpha Crew",
            category: "Community",
            subcategory: "Touhou",
          }),
        ]}
        locale="en"
        detailPathPrefix="/charts"
      />
    );

    expect(html).toContain('data-layout="card-grid"');
    expect(html).not.toContain("data-entry-row=");
  });

  test("renders localized empty state when no entries are available", () => {
    const html = renderToStaticMarkup(
      <CatalogBrowser entries={[]} locale="ja" detailPathPrefix="/ja/charts" />
    );

    expect(html).toContain("一致する譜面は見つかりませんでした");
  });
});
