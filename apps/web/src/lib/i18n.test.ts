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

  test("localizes download source names, statuses, and route badges", async () => {
    const i18n = await loadI18nModule();

    const zh = i18n.getDictionary?.("zh").downloads.sourcePicker;
    const en = i18n.getDictionary?.("en").downloads.sourcePicker;
    const ja = i18n.getDictionary?.("ja").downloads.sourcePicker;

    expect(zh).toMatchObject({
      label: "下载线路",
      statuses: { available: "可用" },
      probe: {
        idle: "-- ms",
        testing: "测速中…",
        unavailable: "不可用",
        unconfigured: "未配置",
      },
      badges: { primary: "推荐", backup: "备用", custom: "自定义" },
      customSaveAndTest: "保存并测速",
      customReset: "恢复 R2",
      manageInSettings: "可在右上角设置中添加和管理自定义线路。",
      switchAndRestart: "换线路继续",
      restartHint: "切换线路后，已完成文件会保留；未完成文件将通过新线路从头下载。",
    });
    expect(Object.values(en?.options ?? {}).map((option) => option.name)).toEqual([
      "R2",
      "Alice",
      "AWMC",
      "G510",
      "G400s",
      "Custom",
    ]);
    expect(ja?.options.r2.name).toBe("R2");
    expect(ja?.options.custom.name).toBe("カスタム");
    expect(en?.restartHint).toContain("Completed files are kept");
    expect(ja?.restartHint).toContain("完了済みファイルは保持");
  });

  test("localizes the unified settings panel", async () => {
    const i18n = await loadI18nModule();
    const zh = i18n.getDictionary?.("zh").settings;
    const en = i18n.getDictionary?.("en").settings;
    const ja = i18n.getDictionary?.("ja").settings;

    expect(zh).toMatchObject({
      open: "打开设置",
      themeLabel: "明暗模式",
      defaultSourceLabel: "默认下载线路",
      defaultFormatLabel: "默认下载格式",
      builtInLocked: "内置线路不可删除",
    });
    expect(en?.motion).toEqual({
      system: "Follow system",
      on: "Motion on",
      off: "Reduce motion",
    });
    expect(en?.formats.adx).toContain("recommended");
    expect(ja?.addCustomSource).toBe("回線を追加");
    expect(ja?.accents.teal).toBe("ティール");
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
        "Browse the AstroDX chart catalog by maimai DX version, category and language, with cover art, difficulty levels, constants and BPM to preview and download.",
      keywords: ["AstroDX", "ADX 谱面资源", "browse charts", "category filter", "display language"],
    });
    expect(jaPages.charts).toEqual({
      pathname: "/charts",
      title: "譜面一覧",
      description:
        "収録されている AstroDX 譜面をすべて閲覧。maimai DX のバージョン分類、カテゴリ、表示言語で絞り込め、各曲のジャケット、難易度レベル、譜面定数、BPM を確認しながらオンラインでプレビュー・ダウンロードできます。",
      keywords: ["AstroDX", "ADX 谱面资源", "譜面一覧", "分類フィルタ", "表示言語"],
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
    expect(metadata?.alternates?.canonical).toBe("https://adxdls.saop.cc/en/search");
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
        page: "home" | "charts"
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

    const metadata = pageMetadata.buildLocalizedPageMetadata?.("ja", "charts");

    expect(metadata?.title).toBe("AstroDX 譜面一覧とダウンロードカタログ | ADX 谱面资源");
    expect(metadata?.description).toBe("収録されている AstroDX 譜面をすべて閲覧。maimai DX のバージョン分類、カテゴリ、表示言語で絞り込め、各曲のジャケット、難易度レベル、譜面定数、BPM を確認しながらオンラインでプレビュー・ダウンロードできます。");
    expect(metadata?.keywords).toEqual([
      "AstroDX",
      "ADX 谱面资源",
      "譜面一覧",
      "分類フィルタ",
      "表示言語",
    ]);
    expect(metadata?.robots).toEqual({
      index: true,
      follow: true,
    });
    expect(metadata?.alternates?.canonical).toBe("https://adxdls.saop.cc/ja/charts");
    expect(metadata?.alternates?.languages).toEqual({
      "x-default": "/charts",
      "zh-CN": "/charts",
      en: "/en/charts",
      ja: "/ja/charts",
    });
    expect(metadata?.openGraph).toMatchObject({
      title: "AstroDX 譜面一覧とダウンロードカタログ | ADX 谱面资源",
      description: "収録されている AstroDX 譜面をすべて閲覧。maimai DX のバージョン分類、カテゴリ、表示言語で絞り込め、各曲のジャケット、難易度レベル、譜面定数、BPM を確認しながらオンラインでプレビュー・ダウンロードできます。",
      url: "https://adxdls.saop.cc/ja/charts",
      siteName: "ADX 谱面资源",
    });
    expect(metadata?.twitter).toMatchObject({
      title: "AstroDX 譜面一覧とダウンロードカタログ | ADX 谱面资源",
      description: "収録されている AstroDX 譜面をすべて閲覧。maimai DX のバージョン分類、カテゴリ、表示言語で絞り込め、各曲のジャケット、難易度レベル、譜面定数、BPM を確認しながらオンラインでプレビュー・ダウンロードできます。",
    });
  });
});
