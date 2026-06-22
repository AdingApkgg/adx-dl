import { describe, expect, test } from "bun:test";

type I18nModule = typeof import("./i18n");
type PageMetadataModule = typeof import("./page-metadata");

async function loadI18nModule(): Promise<Partial<I18nModule>> {
  try {
    return await import("./i18n");
  } catch {
    return {};
  }
}

async function loadPageMetadataModule(): Promise<Partial<PageMetadataModule>> {
  try {
    return await import("./page-metadata");
  } catch {
    return {};
  }
}

describe("i18n helpers", () => {
  test("supports zh en ja and defaults to zh", async () => {
    const i18n = await loadI18nModule();

    expect(typeof i18n.isSupportedLocale).toBe("function");
    expect(i18n.isSupportedLocale?.("zh")).toBe(true);
    expect(i18n.isSupportedLocale?.("en")).toBe(true);
    expect(i18n.isSupportedLocale?.("ja")).toBe(true);
    expect(i18n.isSupportedLocale?.("fr")).toBe(false);
    expect(i18n.normalizeLocale?.()).toBe("zh");
    expect(i18n.normalizeLocale?.("en")).toBe("en");
    expect(i18n.normalizeLocale?.("invalid")).toBe("zh");
  });

  test("builds locale aware paths", async () => {
    const i18n = await loadI18nModule();

    expect(typeof i18n.buildLocalePath).toBe("function");
    expect(i18n.buildLocalePath?.("/", "zh")).toBe("/");
    expect(i18n.buildLocalePath?.("/", "en")).toBe("/en");
    expect(i18n.buildLocalePath?.("/charts", "ja")).toBe("/ja/charts");
    expect(i18n.buildLocalePath?.("charts/42", "zh")).toBe("/charts/42");
  });

  test("strips locale prefixes from localized paths", async () => {
    const i18n = await loadI18nModule();

    expect(typeof i18n.stripLocalePrefix).toBe("function");
    expect(i18n.stripLocalePrefix?.("/")).toBe("/");
    expect(i18n.stripLocalePrefix?.("/zh")).toBe("/");
    expect(i18n.stripLocalePrefix?.("/en/charts")).toBe("/charts");
    expect(i18n.stripLocalePrefix?.("/ja/charts/42")).toBe("/charts/42");
    expect(i18n.stripLocalePrefix?.("/search")).toBe("/search");
  });

  test("switches locale while preserving the underlying route", async () => {
    const i18n = await loadI18nModule();

    expect(typeof i18n.switchLocale).toBe("function");
    expect(i18n.switchLocale?.("/charts", "en")).toBe("/en/charts");
    expect(i18n.switchLocale?.("/en/charts", "zh")).toBe("/charts");
    expect(i18n.switchLocale?.("/ja", "en")).toBe("/en");
    expect(i18n.switchLocale?.("/zh/search", "ja")).toBe("/ja/search");
  });

  test("provides base site dictionary entries for zh en ja", async () => {
    const i18n = await loadI18nModule();

    expect(typeof i18n.getDictionary).toBe("function");
    expect(i18n.getDictionary?.("zh").nav.home).toBe("首页");
    expect(i18n.getDictionary?.("en").nav.home).toBe("Home");
    expect(i18n.getDictionary?.("ja").nav.home).toBe("ホーム");
  });

  test("provides localized Nezha chart descriptions for zh en ja", async () => {
    const i18n = await loadI18nModule();

    expect(typeof i18n.getDictionary).toBe("function");

    const zhStatus = i18n.getDictionary?.("zh").statusPage as Record<string, unknown>;
    const enStatus = i18n.getDictionary?.("en").statusPage as Record<string, unknown>;
    const jaStatus = i18n.getDictionary?.("ja").statusPage as Record<string, unknown>;

    expect(zhStatus.resourceChartsDescription).toBe("CPU、内存与磁盘占用趋势");
    expect(zhStatus.networkChartsDescription).toBe("上传与下载速率趋势");
    expect(enStatus.resourceChartsDescription).toBe("CPU, memory, and disk usage over time");
    expect(enStatus.networkChartsDescription).toBe("Upload and download throughput over time");
    expect(jaStatus.resourceChartsDescription).toBe("CPU・メモリ・ディスク使用率の推移");
    expect(jaStatus.networkChartsDescription).toBe("アップロードとダウンロード速度の推移");
  });

  test("exposes static page metadata entries for zh en ja", async () => {
    const i18n = (await loadI18nModule()) as Partial<I18nModule> & {
      getStaticPageMetadata?: (
        locale?: string | null
      ) => Record<string, { pathname: string; title: string; description: string }>;
    };

    expect(typeof i18n.getStaticPageMetadata).toBe("function");

    const zhPages: Record<string, unknown> = i18n.getStaticPageMetadata?.("zh") ?? {};
    const enPages: Record<string, unknown> = i18n.getStaticPageMetadata?.("en") ?? {};
    const jaPages: Record<string, unknown> = i18n.getStaticPageMetadata?.("ja") ?? {};

    expect(zhPages.home).toEqual({
      pathname: "/",
      title: "AstroDX 谱面资料站与下载入口。",
      description:
        "ADX 谱面资源是一个非官方的 AstroDX 谱面资料站，收录大量 maimai 风格谱面，提供曲目元数据、封面、难度定数与 BPM 等信息，支持按 maimai DX 版本与分类浏览、关键字搜索、在线预览谱面并一键下载导入 AstroDX 模拟器。",
      keywords: ["AstroDX", "ADX 谱面资源", "谱面资料站", "下载入口", "目录索引"],
    });
    expect(enPages.charts).toEqual({
      pathname: "/charts",
      title: "Browse Charts",
      description:
        "Browse the AstroDX chart catalog by maimai DX version, category and language — entries include cover art, difficulty levels, chart constants and BPM to preview and download.",
      keywords: ["AstroDX", "ADX 谱面资源", "browse charts", "category filter", "display language"],
    });
    expect(jaPages.status).toEqual({
      pathname: "/status",
      title: "サーバー状態",
      description: "本サイトとダウンロードサービスの稼働状況をリアルタイムで確認。サーバーの稼働状態、応答遅延、ネットワーク指標などの主要な健全性データを公開監視ページから取得し、AstroDX 譜面の閲覧・ダウンロードが利用可能か把握できます。",
      keywords: ["AstroDX", "ADX 谱面资源", "サーバー状態", "監視ページ", "ネットワーク指標"],
    });
  });

  test("builds localized page metadata with canonical and alternate paths", async () => {
    const pageMetadata = await loadPageMetadataModule();

    expect(typeof pageMetadata.buildPageMetadata).toBe("function");

    const metadata = pageMetadata.buildPageMetadata?.({
      locale: "en",
      pathname: "/search",
      title: "Search",
      description:
        "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment.",
      keywords: [],
    });

    expect(metadata?.title).toBe("Search | ADX 谱面资源");
    expect(metadata?.description).toBe(
      "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment."
    );
    expect(metadata?.alternates?.canonical).toBe("/en/search");
    expect(metadata?.alternates?.languages).toEqual({
      "x-default": "/search",
      "zh-CN": "/search",
      en: "/en/search",
      ja: "/ja/search",
    });
  });

  test("builds localized metadata from named static pages", async () => {
    const pageMetadata = (await loadPageMetadataModule()) as Partial<PageMetadataModule> & {
      buildLocalizedPageMetadata?: (
        locale: "zh" | "en" | "ja",
        page: "home" | "charts" | "status"
      ) => {
        title?: string;
        description?: string;
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
        };
        twitter?: {
          title?: string;
          description?: string;
        };
      };
    };

    expect(typeof pageMetadata.buildLocalizedPageMetadata).toBe("function");

    const metadata = pageMetadata.buildLocalizedPageMetadata?.("ja", "status");

    expect(metadata?.title).toBe("サーバー状態 | ADX 谱面资源");
    expect(metadata?.description).toBe("本サイトとダウンロードサービスの稼働状況をリアルタイムで確認。サーバーの稼働状態、応答遅延、ネットワーク指標などの主要な健全性データを公開監視ページから取得し、AstroDX 譜面の閲覧・ダウンロードが利用可能か把握できます。");
    expect(metadata?.keywords).toEqual([
      "AstroDX",
      "ADX 谱面资源",
      "サーバー状態",
      "監視ページ",
      "ネットワーク指標",
    ]);
    expect(metadata?.robots).toEqual({
      index: true,
      follow: true,
    });
    expect(metadata?.alternates?.canonical).toBe("/ja/status");
    expect(metadata?.alternates?.languages).toEqual({
      "x-default": "/status",
      "zh-CN": "/status",
      en: "/en/status",
      ja: "/ja/status",
    });
    expect(metadata?.openGraph).toMatchObject({
      title: "サーバー状態 | ADX 谱面资源",
      description: "本サイトとダウンロードサービスの稼働状況をリアルタイムで確認。サーバーの稼働状態、応答遅延、ネットワーク指標などの主要な健全性データを公開監視ページから取得し、AstroDX 譜面の閲覧・ダウンロードが利用可能か把握できます。",
      url: "https://adxdls.saop.cc/ja/status",
      siteName: "ADX 谱面资源",
    });
    expect(metadata?.twitter).toMatchObject({
      title: "サーバー状態 | ADX 谱面资源",
      description: "本サイトとダウンロードサービスの稼働状況をリアルタイムで確認。サーバーの稼働状態、応答遅延、ネットワーク指標などの主要な健全性データを公開監視ページから取得し、AstroDX 譜面の閲覧・ダウンロードが利用可能か把握できます。",
    });
  });
});
