import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChartDetailPageView,
  ChartsPageView,
  HomePageView,
  SearchPageView,
} from "@/components/site/page-views";
import type { Catalog } from "@/lib/catalog-shared";
import type { CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { toRouteSlug } from "@/lib/route-slug";

function buildEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const entryId = overrides.id ?? "song-1";
  const entrySlug = toRouteSlug(entryId);

  return {
    id: entryId,
    remote_dir_name: entryId,
    title: "曲目 1",
    title_en: "Song 1",
    artist: "歌手 1",
    artist_en: "Artist 1",
    category: "Official",
    subcategory: "舞萌DX 2025",
    source_archive: "archive-1.adx",
    source_folder: "folder-1",
    version: "Ver.1",
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
      entry_base_url: `/catalog-assets/${entrySlug}`,
      cover_url: `/catalog-assets/${entrySlug}/bg.jpg`,
      audio_url: `/catalog-assets/${entrySlug}/track.mp3`,
      pv_url: `/catalog-assets/${entrySlug}/pv.mp4`,
    },
    difficulties: [{ slot: 0, level: "12+", designer: "Designer 1" }],
    imported_at: "2026-06-12T12:00:00.000Z",
    ...overrides,
  };
}

function buildCatalog(entries: CatalogEntry[], categories: Catalog["categories"]): Catalog {
  return {
    generated_at: "2026-06-12T12:00:00.000Z",
    total_entries: entries.length,
    categories,
    entries,
  };
}

describe("page views locale-driven content", () => {
  test("detail dictionary exposes localized download status copy", () => {
    const enDetail = getDictionary("en").detail;
    const jaDetail = getDictionary("ja").detail;

    expect(enDetail.downloadPreparing).toBe("Reading directory");
    expect(enDetail.downloadPacking(1, 3)).toBe("Downloading and packing (1/3)");
    expect(enDetail.downloadSuccess).toBe("Download started");
    expect(enDetail.downloadErrorPrefix).toBe("Download failed: ");

    expect(jaDetail.downloadPreparing).toBe("ディレクトリを読み込み中");
    expect(jaDetail.downloadPacking(2, 4)).toBe("ダウンロードして圧縮中（2/4）");
    expect(jaDetail.downloadSuccess).toBe("ダウンロードを開始しました");
    expect(jaDetail.downloadErrorPrefix).toBe("ダウンロード失敗: ");
  });

  test("charts view uses the route locale for copy, detail links, and keeps only one filter select", () => {
    const entry = buildEntry();

    const enHtml = renderToStaticMarkup(<ChartsPageView entries={[entry]} locale="en" />);
    const jaHtml = renderToStaticMarkup(<ChartsPageView entries={[entry]} locale="ja" />);

    expect(enHtml).toContain("Song 1");
    expect(enHtml).toContain("Artist 1");
    expect(enHtml).toContain(`href="/en/charts/${toRouteSlug("song-1")}"`);
    expect(enHtml).toContain('data-layout="dense-row-list"');
    expect(enHtml).toContain('data-entry-row="song-1"');
    expect(enHtml).toContain('data-entry-cover="compact"');
    expect(enHtml).toContain('data-entry-meta="primary"');
    expect(enHtml).toContain('data-entry-actions="compact"');
    expect(enHtml).toContain('data-entry-summary="secondary"');
    expect(enHtml).toContain('alt="Song 1 cover"');
    expect(enHtml).toContain("aspect-square");
    expect(enHtml).toContain("Jacket");
    expect(enHtml).toContain("Download");
    expect(enHtml.match(/role="combobox"/g)?.length).toBe(1);

    expect(jaHtml).toContain("曲目 1");
    expect(jaHtml).toContain("歌手 1");
    expect(jaHtml).toContain(`href="/ja/charts/${toRouteSlug("song-1")}"`);
    expect(jaHtml.match(/role="combobox"/g)?.length).toBe(1);
  });

  test("detail view uses english fallback fields only for en and original fields for ja", () => {
    const entry = buildEntry();

    const enHtml = renderToStaticMarkup(<ChartDetailPageView entry={entry} locale="en" />);
    const jaHtml = renderToStaticMarkup(<ChartDetailPageView entry={entry} locale="ja" />);

    expect(enHtml).toContain("Song 1");
    expect(enHtml).toContain("Artist 1");
    expect(enHtml).toContain("Chart Metadata");
    expect(enHtml).toContain("Onsite Download");
    expect(enHtml).toContain('alt="Song 1 cover"');
    expect(enHtml).toContain("/catalog-assets/e-6-1rjq8u6/bg.jpg");

    expect(jaHtml).toContain("曲目 1");
    expect(jaHtml).toContain("歌手 1");
    expect(jaHtml).toContain("譜面情報");
    expect(jaHtml).toContain("サイト内ダウンロード");
  });

  test("home and detail views consume remote catalog branch labels from version and cabinet", () => {
    const remoteEntry = buildEntry({
      id: "remote-song-1",
      remote_dir_name: "remote-song-1",
      category: "Remote",
      subcategory: "legacy-remote-subcategory",
      version: "maimai DX PRiSM",
      cabinet: "DX",
      imported_at: "2026-06-13T12:00:00.000Z",
    });
    const catalog = buildCatalog([remoteEntry], {
      Remote: ["maimai DX PRiSM / DX"],
    });

    const homeHtml = renderToStaticMarkup(<HomePageView catalog={catalog} locale="en" />);
    const detailHtml = renderToStaticMarkup(
      <ChartDetailPageView entry={remoteEntry} locale="en" />
    );

    expect(homeHtml).toContain("Catalog branches");
    expect(homeHtml).toContain("Remote · maimai DX PRiSM / DX");
    expect(homeHtml).not.toContain("Official branches");

    expect(detailHtml).toContain("Remote");
    expect(detailHtml).toContain("maimai DX PRiSM / DX");
    expect(detailHtml).not.toContain("legacy-remote-subcategory");
  });

  test("detail view keeps the onsite download action after wiring the client button", () => {
    const html = renderToStaticMarkup(<ChartDetailPageView entry={buildEntry()} locale="zh" />);

    expect(html).toContain("站内下载");
    expect(html).not.toContain('href="https://downloads.example.com/song-1.zip"');
  });

  test("detail view falls back to branded placeholder when cover is missing", () => {
    const baseEntry = buildEntry();
    const entry = {
      ...baseEntry,
      media: {
        ...baseEntry.media,
        cover_url: "",
      },
      assets: {
        ...baseEntry.assets,
        has_background: false,
      },
    };

    const html = renderToStaticMarkup(<ChartDetailPageView entry={entry} locale="zh" />);

    // The branded placeholder is now an accessible image with a localized label.
    expect(html).toContain('role="img"');
    expect(html).toContain("AstroDX 封面占位图");
  });

  test("search view keeps localized browser copy and localized detail links", () => {
    const entry = buildEntry();

    const enHtml = renderToStaticMarkup(<SearchPageView entries={[entry]} locale="en" />);
    const zhHtml = renderToStaticMarkup(<SearchPageView entries={[entry]} locale="zh" />);

    expect(enHtml).toContain("All Categories");
    expect(enHtml).toContain("Search title, artist, version...");
    expect(enHtml).toContain(`href="/en/charts/${toRouteSlug("song-1")}"`);

    expect(zhHtml).toContain("全部分类");
    expect(zhHtml).toContain("搜索曲名、曲师、版本...");
    expect(zhHtml).toContain(`href="/charts/${toRouteSlug("song-1")}"`);
  });

  test("detail view renders PV and audio players when media is available", () => {
    const slug = toRouteSlug("song-1");
    const html = renderToStaticMarkup(<ChartDetailPageView entry={buildEntry()} locale="zh" />);

    expect(html).toContain("预览");
    expect(html).toContain("<video");
    expect(html).toContain(`src="/catalog-assets/${slug}/pv.mp4"`);
    expect(html).toContain("<audio");
    expect(html).toContain(`src="/catalog-assets/${slug}/track.mp3"`);
  });

  test("detail view omits the preview section when no audio or PV", () => {
    const base = buildEntry();
    const entry = {
      ...base,
      assets: { ...base.assets, has_pv: false, has_audio: false },
    };

    const html = renderToStaticMarkup(<ChartDetailPageView entry={entry} locale="zh" />);

    expect(html).not.toContain("<video");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("预览");
  });
});
