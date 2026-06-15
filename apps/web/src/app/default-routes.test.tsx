import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { Catalog, CatalogEntry } from "@/lib/catalog-shared";

function buildEntry(index: number): CatalogEntry {
  const entryId = index === 3 ? "song-3◆phase" : `song-${index}`;
  const slug = `song-${index}`;

  return {
    id: entryId,
    slug,
    remote_dir_name: entryId,
    title: `曲目 ${index}`,
    title_en: `Song ${index}`,
    artist: `歌手 ${index}`,
    artist_en: `Artist ${index}`,
    category: "Official",
    subcategory: index % 2 === 0 ? "舞萌DX 2024" : "舞萌DX 2025",
    source_archive: `archive-${index}.adx`,
    source_folder: `folder-${index}`,
    version: `Ver.${index}`,
    genre: "Anime",
    cabinet: "DX",
    short_id: `S${index}`,
    bpm: 120 + index,
    offset: null,
    download_mode: index % 3 === 0 ? "mixed" : "onsite",
    download_url: `https://downloads.example.com/song-${index}.zip`,
    source_url: `https://source.example.com/song-${index}`,
    license_note: `license-${index}`,
    files: {
      maidata: `maidata-${index}.txt`,
      maidata_dx: `maidata-dx-${index}.txt`,
      audio: `audio-${index}.mp3`,
      background: `background-${index}.png`,
      pv: `pv-${index}.mp4`,
    },
    assets: {
      has_audio: true,
      has_background: index % 2 === 0,
      has_pv: index % 3 === 0,
      has_dx_chart: true,
    },
    media: {
      entry_base_url: `/covers/${slug}`,
      cover_url: `/covers/${slug}/bg.jpg`,
      audio_url: `/covers/${slug}/track.mp3`,
      pv_url: index % 3 === 0 ? `/covers/${slug}/pv.mp4` : "",
    },
    difficulties: [
      { slot: 0, level: "12+", designer: `Designer ${index}` },
      { slot: 1, level: "13", designer: `CoDesigner ${index}` },
    ],
    imported_at: `2026-06-${String(index).padStart(2, "0")}T12:00:00.000Z`,
  };
}

const entries = Array.from({ length: 9 }, (_, index) => buildEntry(index + 1));

const slugOf = (id: string) => entries.find((entry) => entry.id === id)!.slug!;

const catalog: Catalog = {
  generated_at: "2026-06-12T00:00:00.000Z",
  total_entries: entries.length,
  categories: {
    Official: ["舞萌DX 2024", "舞萌DX 2025"],
  },
  entries,
};

mock.module("@/lib/catalog", () => ({
  readCatalog: async () => catalog,
  readCatalogEntries: async () => entries,
  readEntryById: async (id: string) => entries.find((entry) => entry.id === id),
  readEntryByRouteSlug: async (slug: string) =>
    entries.find((entry) => entry.slug === slug),
  readRouteSlugs: async () => entries.map((entry) => entry.slug!),
  readCanonicalSlugs: async () => entries.map((entry) => entry.slug!),
  readVersionGroups: async () => [],
  readVersionGroup: async () => undefined,
  readVersionSlugs: async () => [],
}));

describe("default zh routes", () => {
  test("root route renders the zh home view and still limits latest entries to 8", async () => {
    const { default: HomePage } = await import("./(default)/page");

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain("AstroDX 谱面资料站与下载入口。");
    expect(html).toContain("搜索曲库");
    expect(html).toContain("浏览版本");
    expect(html).toContain("最新谱面");
    expect(html).toContain("aspect-square");
    expect(html).toContain(`/covers/${slugOf("song-9")}/bg.jpg`);
    expect(html).toContain("曲目 9");
    expect(html).toContain("曲目 2");
    expect(html).not.toContain("曲目 1");
  });

  test("charts route renders the zh list view", async () => {
    const { default: ChartsPage } = await import("./(default)/charts/page");

    const html = renderToStaticMarkup(await ChartsPage());

    expect(html).toContain("浏览曲目");
    expect(html).toContain("按分类、分支与显示语言浏览 AstroDX 目录条目。");
    expect(html).toContain('data-layout="card-grid"');
    expect(html).toContain('href="/charts/song-1"');
    expect(html).toContain('data-entry-actions="compact"');
    expect(html).toContain("曲目 1");
    expect(html).toContain("详情");
    expect(html).not.toContain("Details");
  });

  test("search route renders the zh search view", async () => {
    const { default: SearchPage } = await import("./(default)/search/page");

    const html = renderToStaticMarkup(await SearchPage());

    expect(html).toContain("搜索");
    expect(html).toContain("按关键字、版本分支与谱面信息筛选目录。");
    expect(html).toContain('data-layout="card-grid"');
    expect(html).toContain('data-entry-summary="secondary"');
    expect(html).toContain("曲目 1");
    expect(html).toContain("下载");
    expect(html).not.toContain("Download");
  });

  test("chart detail route renders the zh detail view and actions", async () => {
    const { default: ChartDetailPage, dynamicParams, generateStaticParams } = await import(
      "./(default)/charts/[slug]/page"
    );
    const expectedSlugs = entries.map((entry) => entry.slug!);

    const html = renderToStaticMarkup(
      await ChartDetailPage({
        params: Promise.resolve({ slug: slugOf("song-3◆phase") }),
      })
    );

    expect(dynamicParams).toBe(false);
    expect(await generateStaticParams()).toEqual(expectedSlugs.map((slug) => ({ slug })));
    expect(html).toContain("曲目 3");
    expect(html).toContain("谱面信息");
    expect(html).toContain("难度列表");
    expect(html).toContain("资源状态");
    expect(html).toContain("来源信息");
    expect(html).toContain(`/covers/${slugOf("song-3◆phase")}/bg.jpg`);
    expect(html).toContain("站内下载");
    expect(html).toContain("来源链接");
  });

  test("status route renders the zh status shell", async () => {
    const { default: StatusPage } = await import("./(default)/status/page");

    const html = renderToStaticMarkup(await StatusPage());

    expect(html).toContain("服务器状态");
    expect(html).toContain("查看原监控页");
    expect(html).toContain("立即刷新");
    expect(html).toContain("资源趋势");
    expect(html).toContain("等待更多数据");
  });
});
