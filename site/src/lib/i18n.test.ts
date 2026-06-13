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

  test("builds localized page metadata with canonical and alternate paths", async () => {
    const pageMetadata = await loadPageMetadataModule();

    expect(typeof pageMetadata.buildPageMetadata).toBe("function");

    const metadata = pageMetadata.buildPageMetadata?.({
      locale: "en",
      pathname: "/search",
      title: "Search",
      description:
        "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment.",
    });

    expect(metadata?.title).toBe("Search | AstroDX Archive");
    expect(metadata?.description).toBe(
      "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment."
    );
    expect(metadata?.alternates?.canonical).toBe("/en/search");
    expect(metadata?.alternates?.languages).toEqual({
      "zh-CN": "/search",
      en: "/en/search",
      ja: "/ja/search",
    });
  });
});
