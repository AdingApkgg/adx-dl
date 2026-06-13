import { describe, expect, mock, test } from "bun:test";

import type { CatalogEntry } from "@/lib/catalog-shared";
import { toLegacyRouteSlug, toRouteSlug } from "@/lib/route-slug";

function buildEntry(index: number, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const entryId = overrides.id ?? `song-${index}`;
  const entrySlug = toRouteSlug(entryId);

  return {
    id: entryId,
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
      entry_base_url: `/catalog-assets/${entrySlug}`,
      cover_url: `/catalog-assets/${entrySlug}/bg.jpg`,
      audio_url: `/catalog-assets/${entrySlug}/track.mp3`,
      pv_url: index % 3 === 0 ? `/catalog-assets/${entrySlug}/pv.mp4` : "",
    },
    difficulties: [
      { slot: 0, level: "12+", designer: `Designer ${index}` },
      { slot: 1, level: "13", designer: `CoDesigner ${index}` },
    ],
    imported_at: `2026-06-${String(index).padStart(2, "0")}T12:00:00.000Z`,
    ...overrides,
  };
}

const entries = [
  ...Array.from({ length: 4 }, (_, index) => buildEntry(index + 1)),
  buildEntry(5, {
    id: "remote-song-5",
    remote_dir_name: "remote-song-5",
    title: "远端曲目 5",
    title_en: "Remote Song 5",
    artist: "远端歌手 5",
    artist_en: "Remote Artist 5",
    category: "Remote",
    subcategory: "legacy-remote-subcategory",
    version: "maimai DX PRiSM",
    cabinet: "DX",
  }),
];

mock.module("@/lib/catalog", () => ({
  readCatalog: async () => ({
    generated_at: "2026-06-12T00:00:00.000Z",
    total_entries: entries.length,
    categories: {
      Official: ["舞萌DX 2024", "舞萌DX 2025"],
      Remote: ["maimai DX PRiSM / DX"],
    },
    entries,
  }),
  readCatalogEntries: async () => entries,
  readEntryById: async (id: string) => entries.find((entry) => entry.id === id),
  readEntryByRouteSlug: async (slug: string) => {
    const hashed = entries.find((entry) => toRouteSlug(entry.id) === slug);
    if (hashed) {
      return hashed;
    }

    return entries.find((entry) => toLegacyRouteSlug(entry.id) === slug);
  },
  readRouteSlugs: async () =>
    entries.flatMap((entry) => {
      const hashed = toRouteSlug(entry.id);
      const legacy = toLegacyRouteSlug(entry.id);
      return legacy ? [hashed, legacy] : [hashed];
    }),
}));

function expectLocalizedAlternates(
  metadata: {
    metadataBase?: URL | null;
    alternates?: {
      canonical?: string | URL;
      languages?: Record<string, string | URL | undefined>;
    };
    openGraph?: {
      images?: Array<string | URL | { url: string | URL }>;
    };
    twitter?: {
      images?: Array<string | URL>;
    };
  },
  canonical: string
) {
  const basePath = canonical.replace(/^\/(en|ja)(?=\/|$)/, "") || "/";

  expect(metadata.metadataBase?.toString()).toBe("https://adxdls.saop.cc/");
  expect(metadata.alternates?.canonical).toBe(canonical);
  expect(metadata.alternates?.languages).toEqual({
    "zh-CN": basePath,
    en: canonical.startsWith("/en") ? canonical : `/en${basePath === "/" ? "" : basePath}`,
    ja: canonical.startsWith("/ja") ? canonical : `/ja${basePath === "/" ? "" : basePath}`,
  });
  expect(metadata.openGraph?.images).toEqual(["https://adxdls.saop.cc/opengraph-image.png"]);
  expect(metadata.twitter?.images).toEqual(["https://adxdls.saop.cc/opengraph-image.png"]);
}

describe("route metadata", () => {
  test("default zh pages expose static metadata with alternates", async () => {
    const homeModule = await import("./(default)/page");
    const chartsModule = await import("./(default)/charts/page");
    const searchModule = await import("./(default)/search/page");
    const statusModule = await import("./(default)/status/page");

    expect(homeModule.metadata?.title).toBe("AstroDX 谱面资料站与下载入口。 | AstroDX Archive");
    expect(homeModule.metadata?.description).toBe(
      "构建时扫描远端 AstroDX 目录，提取单曲元数据、谱面信息与统一索引。"
    );
    expectLocalizedAlternates(homeModule.metadata ?? {}, "/");

    expect(chartsModule.metadata?.title).toBe("浏览曲目 | AstroDX Archive");
    expect(chartsModule.metadata?.description).toBe(
      "按分类、分支与显示语言浏览 AstroDX 目录条目。"
    );
    expectLocalizedAlternates(chartsModule.metadata ?? {}, "/charts");

    expect(searchModule.metadata?.title).toBe("搜索 | AstroDX Archive");
    expect(searchModule.metadata?.description).toBe("按关键字、版本分支与谱面信息筛选目录。");
    expectLocalizedAlternates(searchModule.metadata ?? {}, "/search");

    expect(statusModule.metadata?.title).toBe("服务器状态 | AstroDX Archive");
    expect(statusModule.metadata?.description).toBe(
      "查看公开监控页中的服务器关键状态与网络指标。"
    );
    expectLocalizedAlternates(statusModule.metadata ?? {}, "/status");
  });

  test("localized en and ja pages generate locale aware metadata with alternates", async () => {
    const homeModule = await import("./[locale]/page");
    const chartsModule = await import("./[locale]/charts/page");
    const searchModule = await import("./[locale]/search/page");
    const localizedStatusModule = await import("./[locale]/status/page");

    const enHomeMetadata = await homeModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en" }),
    });
    const enChartsMetadata = await chartsModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en" }),
    });
    const jaSearchMetadata = await searchModule.generateMetadata?.({
      params: Promise.resolve({ locale: "ja" }),
    });

    expect(enHomeMetadata?.title).toBe(
      "AstroDX chart archive for browsing, indexing, and downloads. | AstroDX Archive"
    );
    expect(enHomeMetadata?.description).toBe(
      "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment."
    );
    expectLocalizedAlternates(enHomeMetadata ?? {}, "/en");

    expect(enChartsMetadata?.title).toBe("Browse Charts | AstroDX Archive");
    expect(enChartsMetadata?.description).toBe(
      "Explore AstroDX directory entries by category, branch, and display language."
    );
    expectLocalizedAlternates(enChartsMetadata ?? {}, "/en/charts");

    expect(jaSearchMetadata?.title).toBe("検索 | AstroDX Archive");
    expect(jaSearchMetadata?.description).toBe(
      "キーワード、バージョン、譜面情報でカタログを絞り込みます。"
    );
    expectLocalizedAlternates(jaSearchMetadata ?? {}, "/ja/search");

    const enStatusMetadata = await localizedStatusModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en" }),
    });
    expect(enStatusMetadata?.title).toBe("Server Status | AstroDX Archive");
    expect(enStatusMetadata?.description).toBe(
      "View key server health and network metrics from the public monitor page."
    );
    expectLocalizedAlternates(enStatusMetadata ?? {}, "/en/status");
  });

  test("chart detail pages generate localized metadata with cross-locale alternates", async () => {
    const detailModule = await import("./(default)/charts/[slug]/page");
    const localizedDetailModule = await import("./[locale]/charts/[slug]/page");

    const zhMetadata = await detailModule.generateMetadata?.({
      params: Promise.resolve({ slug: "song-3" }),
    });
    const enMetadata = await localizedDetailModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en", slug: "song-3" }),
    });

    expect(zhMetadata?.title).toBe("曲目 3 | AstroDX Archive");
    expect(zhMetadata?.description).toBe("歌手 3 · Official · 舞萌DX 2025");
    expectLocalizedAlternates(zhMetadata ?? {}, `/charts/${toRouteSlug("song-3")}`);

    expect(enMetadata?.title).toBe("Song 3 | AstroDX Archive");
    expect(enMetadata?.description).toBe("Artist 3 · Official · 舞萌DX 2025");
    expectLocalizedAlternates(enMetadata ?? {}, `/en/charts/${toRouteSlug("song-3")}`);
  });

  test("remote chart detail metadata uses the version and cabinet branch label", async () => {
    const detailModule = await import("./(default)/charts/[slug]/page");
    const localizedDetailModule = await import("./[locale]/charts/[slug]/page");

    const zhMetadata = await detailModule.generateMetadata?.({
      params: Promise.resolve({ slug: "remote-song-5" }),
    });
    const enMetadata = await localizedDetailModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en", slug: "remote-song-5" }),
    });

    expect(zhMetadata?.title).toBe("远端曲目 5 | AstroDX Archive");
    expect(zhMetadata?.description).toBe("远端歌手 5 · Remote · maimai DX PRiSM / DX");
    expect(enMetadata?.title).toBe("Remote Song 5 | AstroDX Archive");
    expect(enMetadata?.description).toBe("Remote Artist 5 · Remote · maimai DX PRiSM / DX");
  });
});
