import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("SiteHeader", () => {
  test("renders localized navigation and language switcher for localized detail routes", async () => {
    mock.module("next/navigation", () => ({
      usePathname: () => "/ja/charts/song-3",
    }));

    const { SiteHeader } = await import("./site-header");
    const html = renderToStaticMarkup(<SiteHeader totalEntries={42} />);

    expect(html).toContain("ホーム");
    expect(html).toContain("曲一覧");
    expect(html).toContain("検索");
    expect(html).toContain('href="/ja"');
    expect(html).toContain('href="/ja/charts"');
    expect(html).toContain('href="/ja/search"');
    expect(html).toContain('href="/charts/song-3"');
    expect(html).toContain('href="/en/charts/song-3"');
    expect(html).toContain('href="/ja/charts/song-3"');
  });

  test("renders zh navigation and locale roots on the default locale home route", async () => {
    mock.module("next/navigation", () => ({
      usePathname: () => "/",
    }));

    const { SiteHeader } = await import("./site-header");
    const html = renderToStaticMarkup(<SiteHeader totalEntries={7} />);

    expect(html).toContain("首页");
    expect(html).toContain("曲库");
    expect(html).toContain("搜索");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/charts"');
    expect(html).toContain('href="/search"');
    expect(html).toContain('href="/en"');
    expect(html).toContain('href="/ja"');
  });
});
