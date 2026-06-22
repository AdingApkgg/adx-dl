import type { Metadata } from "next";
import { describe, expect, mock, test } from "bun:test";

import { buildChartDescription, type CatalogEntry } from "@/lib/catalog-shared";

function buildEntry(index: number, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const entryId = overrides.id ?? `song-${index}`;
  const slug = entryId;

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
  readEntryByRouteSlug: async (slug: string) =>
    entries.find((entry) => entry.slug === slug),
  readRouteSlugs: async () => entries.map((entry) => entry.slug!),
  readCanonicalSlugs: async () => entries.map((entry) => entry.slug!),
  readVersionGroups: async () => [
    { slug: "maimai-dx-prism", name: "maimai DX PRiSM", imageIndex: 23, count: 1 },
  ],
  readVersionGroup: async (slug: string) =>
    slug === "maimai-dx-prism"
      ? { name: "maimai DX PRiSM", slug, imageIndex: 23, entries }
      : undefined,
  readVersionSlugs: async () => ["maimai-dx-prism"],
}));

function expectLocalizedAlternates(
  metadata: Metadata,
  canonical: string,
  expected: {
    title: string;
    description: string;
    keywords: string[];
  },
  image?: { url: string; alt: string }
) {
  const basePath = canonical.replace(/^\/(en|ja)(?=\/|$)/, "") || "/";
  const absoluteCanonical = `https://adxdls.saop.cc${canonical === "/" ? "" : canonical}`;
  const fullTitle = `${expected.title} | ADX 谱面资源`;
  const expectedImage = image ?? {
    url: "https://adxdls.saop.cc/opengraph-image.png",
    alt: fullTitle,
  };

  expect(metadata.metadataBase?.toString()).toBe("https://adxdls.saop.cc/");
  expect(metadata.keywords).toEqual(expected.keywords);
  expect(metadata.robots).toMatchObject({
    index: true,
    follow: true,
  });
  expect(metadata.alternates?.canonical).toBe(canonical);
  expect(metadata.alternates?.languages).toEqual({
    "x-default": basePath,
    "zh-CN": basePath,
    en: canonical.startsWith("/en") ? canonical : `/en${basePath === "/" ? "" : basePath}`,
    ja: canonical.startsWith("/ja") ? canonical : `/ja${basePath === "/" ? "" : basePath}`,
  });
  expect(metadata.openGraph).toMatchObject({
    title: fullTitle,
    description: expected.description,
    url: absoluteCanonical,
    siteName: "ADX 谱面资源",
  });
  expect(metadata.openGraph?.images).toEqual([expectedImage]);
  expect(metadata.twitter).toMatchObject({
    title: fullTitle,
    description: expected.description,
  });
  expect(metadata.twitter?.images).toEqual([expectedImage]);
}

describe("route metadata", () => {
  test("default zh pages expose static metadata with alternates", async () => {
    const homeModule = await import("./(default)/page");
    const chartsModule = await import("./(default)/charts/page");
    const searchModule = await import("./(default)/search/page");
    const statusModule = await import("./(default)/status/page");

    expect(homeModule.metadata?.title).toBe("AstroDX 谱面资料站与下载入口。 | ADX 谱面资源");
    expect(homeModule.metadata?.description).toBe(
      "ADX 谱面资源是一个非官方的 AstroDX 谱面资料站，收录大量 maimai 风格谱面，提供曲目元数据、封面、难度定数与 BPM 等信息，支持按 maimai DX 版本与分类浏览、关键字搜索、在线预览谱面并一键下载导入 AstroDX 模拟器。"
    );
    expectLocalizedAlternates(homeModule.metadata ?? {}, "/", {
      title: "AstroDX 谱面资料站与下载入口。",
      description: "ADX 谱面资源是一个非官方的 AstroDX 谱面资料站，收录大量 maimai 风格谱面，提供曲目元数据、封面、难度定数与 BPM 等信息，支持按 maimai DX 版本与分类浏览、关键字搜索、在线预览谱面并一键下载导入 AstroDX 模拟器。",
      keywords: ["AstroDX", "ADX 谱面资源", "谱面资料站", "下载入口", "目录索引"],
    });

    expect(chartsModule.metadata?.title).toBe("浏览曲目 | ADX 谱面资源");
    expect(chartsModule.metadata?.description).toBe(
      "浏览本站收录的全部 AstroDX 谱面，可按 maimai DX 版本分支、谱面分类与显示语言筛选，每首曲目均提供封面、难度等级、谱面定数与 BPM 等信息，支持在线预览并下载导入 AstroDX 模拟器。"
    );
    expectLocalizedAlternates(chartsModule.metadata ?? {}, "/charts", {
      title: "浏览曲目",
      description: "浏览本站收录的全部 AstroDX 谱面，可按 maimai DX 版本分支、谱面分类与显示语言筛选，每首曲目均提供封面、难度等级、谱面定数与 BPM 等信息，支持在线预览并下载导入 AstroDX 模拟器。",
      keywords: ["AstroDX", "ADX 谱面资源", "浏览曲目", "分类筛选", "显示语言"],
    });

    expect(searchModule.metadata?.title).toBe("搜索 | ADX 谱面资源");
    expect(searchModule.metadata?.description).toBe("在本站收录的全部 AstroDX 谱面中，按曲名、曲师、关键字、maimai DX 版本分支与谱面难度等信息快速搜索筛选，实时定位目标谱面并查看封面与定数详情，支持在线预览与下载。");
    expectLocalizedAlternates(searchModule.metadata ?? {}, "/search", {
      title: "搜索",
      description: "在本站收录的全部 AstroDX 谱面中，按曲名、曲师、关键字、maimai DX 版本分支与谱面难度等信息快速搜索筛选，实时定位目标谱面并查看封面与定数详情，支持在线预览与下载。",
      keywords: ["AstroDX", "ADX 谱面资源", "搜索", "关键字筛选", "版本分支"],
    });

    expect(statusModule.metadata?.title).toBe("服务器状态 | ADX 谱面资源");
    expect(statusModule.metadata?.description).toBe(
      "实时查看本站与下载服务的运行状态，包括服务器在线情况、响应延迟、网络指标与关键健康数据，数据来自公开监控页面，便于了解 AstroDX 谱面浏览与下载服务当前是否可用。"
    );
    expectLocalizedAlternates(statusModule.metadata ?? {}, "/status", {
      title: "服务器状态",
      description: "实时查看本站与下载服务的运行状态，包括服务器在线情况、响应延迟、网络指标与关键健康数据，数据来自公开监控页面，便于了解 AstroDX 谱面浏览与下载服务当前是否可用。",
      keywords: ["AstroDX", "ADX 谱面资源", "服务器状态", "监控页", "网络指标"],
    });
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
      "AstroDX chart archive for browsing, indexing, and downloads. | ADX 谱面资源"
    );
    expect(enHomeMetadata?.description).toBe(
      "An unofficial AstroDX archive of maimai-style charts — per-song metadata, cover art, difficulty constants and BPM, ready to browse by version, search, preview online and download."
    );
    expectLocalizedAlternates(enHomeMetadata ?? {}, "/en", {
      title: "AstroDX chart archive for browsing, indexing, and downloads.",
      description:
        "An unofficial AstroDX archive of maimai-style charts — per-song metadata, cover art, difficulty constants and BPM, ready to browse by version, search, preview online and download.",
      keywords: ["AstroDX", "ADX 谱面资源", "chart archive", "downloads", "catalog index"],
    });

    expect(enChartsMetadata?.title).toBe("Browse Charts | ADX 谱面资源");
    expect(enChartsMetadata?.description).toBe(
      "Browse the AstroDX chart catalog by maimai DX version, category and language — entries include cover art, difficulty levels, chart constants and BPM to preview and download."
    );
    expectLocalizedAlternates(enChartsMetadata ?? {}, "/en/charts", {
      title: "Browse Charts",
      description: "Browse the AstroDX chart catalog by maimai DX version, category and language — entries include cover art, difficulty levels, chart constants and BPM to preview and download.",
      keywords: ["AstroDX", "ADX 谱面资源", "browse charts", "category filter", "display language"],
    });

    expect(jaSearchMetadata?.title).toBe("検索 | ADX 谱面资源");
    expect(jaSearchMetadata?.description).toBe(
      "収録済みの AstroDX 譜面全体を、曲名、アーティスト、キーワード、maimai DX バージョン分類、譜面難易度などの情報で検索・絞り込み。目的の譜面をすぐに見つけ、詳細を確認してオンラインでプレビュー・ダウンロードできます。"
    );
    expectLocalizedAlternates(jaSearchMetadata ?? {}, "/ja/search", {
      title: "検索",
      description: "収録済みの AstroDX 譜面全体を、曲名、アーティスト、キーワード、maimai DX バージョン分類、譜面難易度などの情報で検索・絞り込み。目的の譜面をすぐに見つけ、詳細を確認してオンラインでプレビュー・ダウンロードできます。",
      keywords: ["AstroDX", "ADX 谱面资源", "検索", "キーワード", "譜面情報"],
    });

    const enStatusMetadata = await localizedStatusModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en" }),
    });
    expect(enStatusMetadata?.title).toBe("Server Status | ADX 谱面资源");
    expect(enStatusMetadata?.description).toBe(
      "Check the live status of this site and its download service — server uptime, response latency, network metrics and key health data from the public monitor page."
    );
    expectLocalizedAlternates(enStatusMetadata ?? {}, "/en/status", {
      title: "Server Status",
      description: "Check the live status of this site and its download service — server uptime, response latency, network metrics and key health data from the public monitor page.",
      keywords: ["AstroDX", "ADX 谱面资源", "server status", "monitor page", "network metrics"],
    });
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

    const entry3 = buildEntry(3);
    const song3Slug = "song-3";
    const song3Cover = `/covers/${song3Slug}/bg.jpg`;
    const zhDescription = buildChartDescription(entry3, "zh");
    const enDescription = buildChartDescription(entry3, "en");

    expect(zhMetadata?.title).toBe("曲目 3 | ADX 谱面资源");
    expect(zhMetadata?.description).toBe(zhDescription);
    expectLocalizedAlternates(
      zhMetadata ?? {},
      `/charts/${song3Slug}`,
      {
        title: "曲目 3",
        description: zhDescription,
        keywords: ["AstroDX", "ADX 谱面资源", "曲目 3", "歌手 3", "舞萌DX 2025", "Anime", "maimai"],
      },
      { url: song3Cover, alt: "曲目 3" }
    );

    expect(enMetadata?.title).toBe("Song 3 | ADX 谱面资源");
    expect(enMetadata?.description).toBe(enDescription);
    expectLocalizedAlternates(
      enMetadata ?? {},
      `/en/charts/${song3Slug}`,
      {
        title: "Song 3",
        description: enDescription,
        keywords: ["AstroDX", "ADX 谱面资源", "Song 3", "Artist 3", "舞萌DX 2025", "Anime", "maimai"],
      },
      { url: song3Cover, alt: "Song 3" }
    );
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

    const entry5 = buildEntry(5, {
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
    });
    const zhDescription = buildChartDescription(entry5, "zh");
    const enDescription = buildChartDescription(entry5, "en");

    // Remote branch label (version / cabinet) must appear in the synthesized prose.
    expect(zhMetadata?.title).toBe("远端曲目 5 | ADX 谱面资源");
    expect(zhMetadata?.description).toBe(zhDescription);
    expect(zhDescription).toContain("maimai DX PRiSM / DX");
    expect(enMetadata?.title).toBe("Remote Song 5 | ADX 谱面资源");
    expect(enMetadata?.description).toBe(enDescription);
    expect(zhMetadata?.openGraph).toMatchObject({
      title: "远端曲目 5 | ADX 谱面资源",
      description: zhDescription,
      url: `https://adxdls.saop.cc/charts/remote-song-5`,
      siteName: "ADX 谱面资源",
    });
    expect(enMetadata?.twitter).toMatchObject({
      title: "Remote Song 5 | ADX 谱面资源",
      description: enDescription,
    });
  });
});

describe("metadata files", () => {
  test("sitemap exposes localized static routes and chart detail alternates", async () => {
    const sitemapModule = await import("./sitemap").catch(() => null);

    expect(sitemapModule).not.toBeNull();

    const sitemap = await sitemapModule?.default?.();

    expect(sitemap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://adxdls.saop.cc/",
          alternates: {
            languages: {
              "x-default": "https://adxdls.saop.cc/",
              "zh-CN": "https://adxdls.saop.cc/",
              en: "https://adxdls.saop.cc/en",
              ja: "https://adxdls.saop.cc/ja",
            },
          },
        }),
        expect.objectContaining({
          url: "https://adxdls.saop.cc/charts",
          alternates: {
            languages: {
              "x-default": "https://adxdls.saop.cc/charts",
              "zh-CN": "https://adxdls.saop.cc/charts",
              en: "https://adxdls.saop.cc/en/charts",
              ja: "https://adxdls.saop.cc/ja/charts",
            },
          },
        }),
        expect.objectContaining({
          url: `https://adxdls.saop.cc/charts/song-3`,
          alternates: {
            languages: {
              "x-default": `https://adxdls.saop.cc/charts/song-3`,
              "zh-CN": `https://adxdls.saop.cc/charts/song-3`,
              en: `https://adxdls.saop.cc/en/charts/song-3`,
              ja: `https://adxdls.saop.cc/ja/charts/song-3`,
            },
          },
        }),
      ])
    );
  });

  test("robots publishes the sitemap URL and allow rules (incl. AI crawlers)", async () => {
    const robotsModule = await import("./robots").catch(() => null);

    expect(robotsModule).not.toBeNull();

    const robots = (
      typeof robotsModule?.default === "function" ? robotsModule.default() : robotsModule?.default
    ) as
      | {
          rules?: Array<{ userAgent?: string | string[]; allow?: string | string[] }>;
          sitemap?: string;
          host?: string;
        }
      | undefined;

    expect(robots?.sitemap).toBe("https://adxdls.saop.cc/sitemap.xml");
    expect(robots?.host).toBe("https://adxdls.saop.cc");
    expect(Array.isArray(robots?.rules)).toBe(true);
    expect(robots?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userAgent: "*", allow: "/" }),
      ])
    );
    // An explicit AI/answer-engine crawler must be present and allowed.
    const agents = (robots?.rules ?? []).flatMap((rule) =>
      Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent]
    );
    expect(agents).toContain("GPTBot");
  });
});
