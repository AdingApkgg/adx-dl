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

const entries = Array.from({ length: 4 }, (_, index) => buildEntry(index + 1));

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

const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});

mock.module("next/navigation", () => ({
  notFound,
}));

describe("localized routes", () => {
  test("localized home route renders shared view for en and ja", async () => {
    const { default: LocalizedHomePage, generateStaticParams } = await import("./[locale]/page");

    expect(await generateStaticParams()).toEqual([{ locale: "en" }, { locale: "ja" }]);

    const enHtml = renderToStaticMarkup(
      await LocalizedHomePage({
        params: Promise.resolve({ locale: "en" }),
      })
    );
    const jaHtml = renderToStaticMarkup(
      await LocalizedHomePage({
        params: Promise.resolve({ locale: "ja" }),
      })
    );

    expect(enHtml).toContain("AstroDX chart archive for browsing, indexing, and downloads.");
    expect(jaHtml).toContain("AstroDX 譜面アーカイブとダウンロード入口。");
  });

  test("localized charts and search routes render shared en and ja views", async () => {
    const { default: LocalizedChartsPage, generateStaticParams: chartStaticParams } =
      await import("./[locale]/charts/page");
    const { default: LocalizedSearchPage, generateStaticParams: searchStaticParams } =
      await import("./[locale]/search/page");

    expect(await chartStaticParams()).toEqual([{ locale: "en" }, { locale: "ja" }]);
    expect(await searchStaticParams()).toEqual([{ locale: "en" }, { locale: "ja" }]);

    const chartsHtml = renderToStaticMarkup(
      await LocalizedChartsPage({
        params: Promise.resolve({ locale: "en" }),
      })
    );
    const searchHtml = renderToStaticMarkup(
      await LocalizedSearchPage({
        params: Promise.resolve({ locale: "ja" }),
      })
    );

    expect(chartsHtml).toContain("Browse Charts");
    expect(chartsHtml).toContain('data-layout="card-grid"');
    expect(chartsHtml).toContain('href="/en/charts/song-1"');
    expect(chartsHtml).toContain("Song 1");
    expect(searchHtml).toContain('data-layout="card-grid"');
    expect(searchHtml).toContain('href="/ja/charts/song-1"');
    expect(searchHtml).toContain("検索");
    expect(searchHtml).toContain("曲目 1");
  });

  test("localized chart detail route renders shared localized view and generates en ja params", async () => {
    const { default: LocalizedChartDetailPage, dynamicParams, generateStaticParams } = await import(
      "./[locale]/charts/[slug]/page"
    );
    const expectedSlugs = entries.map((entry) => entry.slug!);

    expect(dynamicParams).toBe(false);
    expect(await generateStaticParams()).toEqual(
      ["en", "ja"].flatMap((locale) =>
        expectedSlugs.map((slug) => ({ locale, slug }))
      )
    );

    const enHtml = renderToStaticMarkup(
      await LocalizedChartDetailPage({
        params: Promise.resolve({
          locale: "en",
          slug: slugOf("song-3◆phase"),
        }),
      })
    );
    const jaHtml = renderToStaticMarkup(
      await LocalizedChartDetailPage({
        params: Promise.resolve({
          locale: "ja",
          slug: slugOf("song-3◆phase"),
        }),
      })
    );

    expect(enHtml).toContain("Song 3");
    expect(enHtml).toContain("Chart Metadata");
    expect(jaHtml).toContain("曲目 3");
    expect(jaHtml).toContain("譜面情報");
  });

  test("localized status route renders shared en and ja status shell", async () => {
    const { default: LocalizedStatusPage, generateStaticParams } = await import(
      "./[locale]/status/page"
    );

    expect(await generateStaticParams()).toEqual([{ locale: "en" }, { locale: "ja" }]);

    const enHtml = renderToStaticMarkup(
      await LocalizedStatusPage({ params: Promise.resolve({ locale: "en" }) })
    );
    const jaHtml = renderToStaticMarkup(
      await LocalizedStatusPage({ params: Promise.resolve({ locale: "ja" }) })
    );

    expect(enHtml).toContain("Server Status");
    expect(enHtml).toContain("Refresh Now");
    expect(enHtml).toContain("Resource Trends");
    expect(enHtml).toContain("Waiting for more data");
    expect(jaHtml).toContain("サーバー状態");
    expect(jaHtml).toContain("今すぐ更新");
    expect(jaHtml).toContain("リソース推移");
    expect(jaHtml).toContain("より多くのデータを待っています");
  });

  test("zh and invalid locale routes throw notFound", async () => {
    notFound.mockClear();

    const { default: LocalizedHomePage } = await import("./[locale]/page");
    const { default: LocalizedChartDetailPage } = await import("./[locale]/charts/[slug]/page");

    await expect(
      LocalizedHomePage({
        params: Promise.resolve({ locale: "zh" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    await expect(
      LocalizedHomePage({
        params: Promise.resolve({ locale: "fr" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    await expect(
      LocalizedChartDetailPage({
        params: Promise.resolve({ locale: "zh", slug: "song-1" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(3);
  });
});
