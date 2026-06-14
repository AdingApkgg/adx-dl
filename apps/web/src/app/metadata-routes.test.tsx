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
      entry_base_url: `/catalog-assets/${slug}`,
      cover_url: `/catalog-assets/${slug}/bg.jpg`,
      audio_url: `/catalog-assets/${slug}/track.mp3`,
      pv_url: index % 3 === 0 ? `/catalog-assets/${slug}/pv.mp4` : "",
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
  metadata: {
    metadataBase?: URL | null;
    keywords?: string[] | null;
    robots?: {
      index?: boolean;
      follow?: boolean;
    };
    alternates?: {
      canonical?: string | URL;
      languages?: Record<string, string | URL | undefined>;
    };
    openGraph?: {
      title?: string;
      description?: string;
      url?: string | URL;
      siteName?: string;
      locale?: string;
      images?: Array<string | URL | { url: string | URL; alt?: string }>;
    };
    twitter?: {
      title?: string;
      description?: string;
      images?: Array<string | URL | { url: string | URL; alt?: string }>;
    };
  },
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
      "构建时扫描远端 AstroDX 目录，提取单曲元数据、谱面信息与统一索引。"
    );
    expectLocalizedAlternates(homeModule.metadata ?? {}, "/", {
      title: "AstroDX 谱面资料站与下载入口。",
      description: "构建时扫描远端 AstroDX 目录，提取单曲元数据、谱面信息与统一索引。",
      keywords: ["AstroDX", "ADX 谱面资源", "谱面资料站", "下载入口", "目录索引"],
    });

    expect(chartsModule.metadata?.title).toBe("浏览曲目 | ADX 谱面资源");
    expect(chartsModule.metadata?.description).toBe(
      "按分类、分支与显示语言浏览 AstroDX 目录条目。"
    );
    expectLocalizedAlternates(chartsModule.metadata ?? {}, "/charts", {
      title: "浏览曲目",
      description: "按分类、分支与显示语言浏览 AstroDX 目录条目。",
      keywords: ["AstroDX", "ADX 谱面资源", "浏览曲目", "分类筛选", "显示语言"],
    });

    expect(searchModule.metadata?.title).toBe("搜索 | ADX 谱面资源");
    expect(searchModule.metadata?.description).toBe("按关键字、版本分支与谱面信息筛选目录。");
    expectLocalizedAlternates(searchModule.metadata ?? {}, "/search", {
      title: "搜索",
      description: "按关键字、版本分支与谱面信息筛选目录。",
      keywords: ["AstroDX", "ADX 谱面资源", "搜索", "关键字筛选", "版本分支"],
    });

    expect(statusModule.metadata?.title).toBe("服务器状态 | ADX 谱面资源");
    expect(statusModule.metadata?.description).toBe(
      "查看公开监控页中的服务器关键状态与网络指标。"
    );
    expectLocalizedAlternates(statusModule.metadata ?? {}, "/status", {
      title: "服务器状态",
      description: "查看公开监控页中的服务器关键状态与网络指标。",
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
      "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment."
    );
    expectLocalizedAlternates(enHomeMetadata ?? {}, "/en", {
      title: "AstroDX chart archive for browsing, indexing, and downloads.",
      description:
        "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment.",
      keywords: ["AstroDX", "ADX 谱面资源", "chart archive", "downloads", "catalog index"],
    });

    expect(enChartsMetadata?.title).toBe("Browse Charts | ADX 谱面资源");
    expect(enChartsMetadata?.description).toBe(
      "Explore AstroDX directory entries by category, branch, and display language."
    );
    expectLocalizedAlternates(enChartsMetadata ?? {}, "/en/charts", {
      title: "Browse Charts",
      description: "Explore AstroDX directory entries by category, branch, and display language.",
      keywords: ["AstroDX", "ADX 谱面资源", "browse charts", "category filter", "display language"],
    });

    expect(jaSearchMetadata?.title).toBe("検索 | ADX 谱面资源");
    expect(jaSearchMetadata?.description).toBe(
      "キーワード、バージョン、譜面情報でカタログを絞り込みます。"
    );
    expectLocalizedAlternates(jaSearchMetadata ?? {}, "/ja/search", {
      title: "検索",
      description: "キーワード、バージョン、譜面情報でカタログを絞り込みます。",
      keywords: ["AstroDX", "ADX 谱面资源", "検索", "キーワード", "譜面情報"],
    });

    const enStatusMetadata = await localizedStatusModule.generateMetadata?.({
      params: Promise.resolve({ locale: "en" }),
    });
    expect(enStatusMetadata?.title).toBe("Server Status | ADX 谱面资源");
    expect(enStatusMetadata?.description).toBe(
      "View key server health and network metrics from the public monitor page."
    );
    expectLocalizedAlternates(enStatusMetadata ?? {}, "/en/status", {
      title: "Server Status",
      description: "View key server health and network metrics from the public monitor page.",
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
    const song3Cover = `/catalog-assets/${song3Slug}/bg.jpg`;
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
        keywords: ["AstroDX", "ADX 谱面资源", "曲目 3", "歌手 3", "舞萌DX 2025"],
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
        keywords: ["AstroDX", "ADX 谱面资源", "Song 3", "Artist 3", "舞萌DX 2025"],
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
