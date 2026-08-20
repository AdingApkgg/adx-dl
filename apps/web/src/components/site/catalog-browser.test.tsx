import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  toCatalogCardEntry,
  type CatalogEntry,
  type ChartDownloadSpec,
} from "@/lib/catalog-shared";
import {
  buildSelectedCatalogCharts,
  catalogVersionFilterId,
  CatalogBrowser,
  foldUtageGenreIntoCabinet,
  isCabinetLockedOut,
  normalizeVersionFilterId,
} from "./catalog-browser";

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

describe("CatalogBrowser", () => {
  test("normalizes version entries and legacy query names to stable ids", () => {
    expect(catalogVersionFilterId({ versionid: 24, version: "stale-name" })).toBe("24");
    expect(catalogVersionFilterId({ version: "maimai DX PRiSM" })).toBe("23");
    expect(catalogVersionFilterId({ versionid: 999, version: "maimai DX PRiSM" })).toBe("23");
    expect(catalogVersionFilterId({ version: "unmapped" })).toBe("unknown");

    expect(normalizeVersionFilterId("24")).toBe("24");
    expect(normalizeVersionFilterId("024")).toBe("24");
    expect(normalizeVersionFilterId("Unknown")).toBe("unknown");
    expect(normalizeVersionFilterId("maimai DX PRiSM PLUS")).toBe("24");
    expect(normalizeVersionFilterId("999")).toBeNull();
    expect(normalizeVersionFilterId("not-a-version")).toBeNull();
  });

  test("folds a genre=107 link onto the Type row's UTAGE chip", () => {
    // The genre row has no 宴会場 chip, so a raw ?genre=107 link used to filter
    // the grid while leaving every chip in the panel unlit.
    expect(foldUtageGenreIntoCabinet(new Set(["107"]), null)).toEqual({
      genreIds: new Set(),
      cabinetIds: new Set(["UTAGE"]),
    });

    // Mixed with a real genre: only the 107 moves across.
    expect(foldUtageGenreIntoCabinet(new Set(["103", "107"]), null)).toEqual({
      genreIds: new Set(["103"]),
      cabinetIds: new Set(["UTAGE"]),
    });

    // Already-selected cabinets survive, and UTAGE doesn't duplicate.
    expect(foldUtageGenreIntoCabinet(new Set(["107"]), new Set(["DX", "UTAGE"]))).toEqual({
      genreIds: new Set(),
      cabinetIds: new Set(["DX", "UTAGE"]),
    });
  });

  test("accepts the bucket's former UTG id from shared links", () => {
    expect(foldUtageGenreIntoCabinet(null, new Set(["UTG"]))).toEqual({
      genreIds: null,
      cabinetIds: new Set(["UTAGE"]),
    });
    // Both spellings at once collapse to one chip, not two.
    expect(foldUtageGenreIntoCabinet(null, new Set(["UTG", "UTAGE"]))).toEqual({
      genreIds: null,
      cabinetIds: new Set(["UTAGE"]),
    });
    // And the genre=107 route agrees with it.
    expect(foldUtageGenreIntoCabinet(new Set(["107"]), new Set(["UTG"]))).toEqual({
      genreIds: new Set(),
      cabinetIds: new Set(["UTAGE"]),
    });
  });

  test("宴会場 locks out the other cabinet chips, DX and ST do not lock each other", () => {
    const none = new Set<string>();
    // Nothing picked: every chip is open.
    expect(isCabinetLockedOut("DX", none)).toBe(false);
    expect(isCabinetLockedOut("UTAGE", none)).toBe(false);

    // 宴会場 picked: the normal-chart types lock, and it stays clickable to undo.
    const utage = new Set(["UTAGE"]);
    expect(isCabinetLockedOut("DX", utage)).toBe(true);
    expect(isCabinetLockedOut("SD", utage)).toBe(true);
    expect(isCabinetLockedOut("UTAGE", utage)).toBe(false);

    // A normal type picked: 宴会場 locks, but the other normal type stays open —
    // "DX or ST" is a real query (everything that isn't 宴会場).
    const dx = new Set(["DX"]);
    expect(isCabinetLockedOut("UTAGE", dx)).toBe(true);
    expect(isCabinetLockedOut("SD", dx)).toBe(false);
    expect(isCabinetLockedOut("DX", dx)).toBe(false);

    const both = new Set(["DX", "SD"]);
    expect(isCabinetLockedOut("UTAGE", both)).toBe(true);
    expect(isCabinetLockedOut("DX", both)).toBe(false);
  });

  test("leaves untouched dimensions null and drops values naming no chip", () => {
    // null means "the URL didn't mention this dimension" — the caller then keeps
    // its default rather than clearing it.
    expect(foldUtageGenreIntoCabinet(null, null)).toEqual({
      genreIds: null,
      cabinetIds: null,
    });
    expect(foldUtageGenreIntoCabinet(null, new Set(["SD"]))).toEqual({
      genreIds: null,
      cabinetIds: new Set(["SD"]),
    });
    expect(foldUtageGenreIntoCabinet(new Set(["999", "abc"]), null)).toEqual({
      genreIds: new Set(),
      cabinetIds: null,
    });
    // An unknown cabinet would otherwise filter the grid down to nothing with no
    // chip lit to explain it.
    expect(foldUtageGenreIntoCabinet(null, new Set(["SD", "nope"]))).toEqual({
      genreIds: null,
      cabinetIds: new Set(["SD"]),
    });
  });

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
    // Dimension chip rows live inside the collapsed-by-default advanced panel.
    expect(html).toContain("Advanced filters");
    expect(html).toContain("Search title, romaji, alias, artist, charter, version...");
    // The search box is a named landmark, not a bare placeholder.
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Search charts"');
  });

  test("renders the sort picker with its current option spelled out in the static HTML", () => {
    const html = renderToStaticMarkup(
      <CatalogBrowser entries={[buildEntry({})]} locale="en" detailPathPrefix="/charts" />
    );

    // Radix portals the selected item's text out of the (closed) dropdown, so
    // the trigger has to carry the label itself or it renders blank before the
    // first open.
    expect(html).toContain("Default order");
    expect(html).toContain("Sort");
  });

  test("renders slim card entries without the download payload (payload-slimming contract)", () => {
    const html = renderToStaticMarkup(
      <CatalogBrowser
        entries={[
          toCatalogCardEntry(buildEntry({ aliases: ["阿尔法"] })),
          toCatalogCardEntry(buildEntry({ id: "official-gamma", title: "月光列车" })),
        ]}
        locale="zh"
        detailPathPrefix="/charts"
      />
    );

    expect(html).toContain("Alpha Star");
    expect(html).toContain("月光列车");
    expect(html).toContain("阿尔法");
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

  test("keeps the global version folders when a browse-page batch spans versions", () => {
    const entries = [
      toCatalogCardEntry(
        buildEntry({
          id: "circle-song",
          version: "maimai DX CiRCLE",
          subcategory: "maimai DX CiRCLE",
        })
      ),
      toCatalogCardEntry(
        buildEntry({
          id: "prism-song",
          version: "maimai DX PRiSM PLUS",
          subcategory: "maimai DX PRiSM PLUS",
        })
      ),
    ];
    const specs: Record<string, ChartDownloadSpec> = {
      "circle-song": {
        dir: "Same Song",
        files: [{ name: "maidata.txt", url: "/circle" }],
        groupDir: "25 CiRCLE",
      },
      "prism-song": {
        dir: "Same Song",
        files: [{ name: "maidata.txt", url: "/prism" }],
        groupDir: "24 PRiSM PLUS",
      },
    };

    expect(
      buildSelectedCatalogCharts(entries, specs, new Set(["circle-song", "prism-song"]))
    ).toEqual([
      {
        dir: "Same Song",
        files: [{ name: "maidata.txt", url: "/circle" }],
        groupDir: "25 CiRCLE",
      },
      {
        dir: "Same Song",
        files: [{ name: "maidata.txt", url: "/prism" }],
        groupDir: "24 PRiSM PLUS",
      },
    ]);
  });

  test("keeps the global version folder even when selected charts share one version", () => {
    const entries = [
      toCatalogCardEntry(
        buildEntry({
          id: "circle-a",
          version: "maimai DX CiRCLE",
          subcategory: "maimai DX CiRCLE",
        })
      ),
      toCatalogCardEntry(
        buildEntry({
          id: "circle-b",
          title: "Beta Star",
          version: "maimai DX CiRCLE",
          subcategory: "maimai DX CiRCLE",
        })
      ),
    ];
    const specs: Record<string, ChartDownloadSpec> = {
      "circle-a": {
        dir: "Alpha Star",
        files: [{ name: "maidata.txt", url: "/a" }],
        groupDir: "25 CiRCLE",
      },
      "circle-b": {
        dir: "Beta Star",
        files: [{ name: "maidata.txt", url: "/b" }],
        groupDir: "25 CiRCLE",
      },
    };

    expect(buildSelectedCatalogCharts(entries, specs, new Set(["circle-a", "circle-b"]))).toEqual([
      { dir: "Alpha Star", files: [{ name: "maidata.txt", url: "/a" }], groupDir: "25 CiRCLE" },
      { dir: "Beta Star", files: [{ name: "maidata.txt", url: "/b" }], groupDir: "25 CiRCLE" },
    ]);
  });
});
