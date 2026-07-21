import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push() {} }),
}));

describe("SiteHeader", () => {
  test("renders localized navigation and language switcher for localized detail routes", async () => {
    mock.module("next/navigation", () => ({
      usePathname: () => "/ja/charts/song-3",
      useRouter: () => ({ push() {} }),
    }));

    const { SiteHeader } = await import("./site-header");
    const html = renderToStaticMarkup(<SiteHeader totalEntries={42} />);

    expect(html).toContain("ホーム");
    expect(html).toContain("曲一覧");
    expect(html).toContain("ランダム");
    expect(html).toContain('href="/ja"');
    expect(html).toContain('href="/ja/charts"');
    expect(html).not.toContain('href="/ja/search"');
    // The locale + theme switchers are dropdown triggers; their menus mount on
    // open, so only the trigger buttons appear in the server-rendered markup.
    // Cross-locale discovery is handled by hreflang alternates, not these links.
    expect(html).toContain('aria-label="言語切り替え"');
    expect(html).toContain('aria-label="テーマ切り替え"');
  });

  test("renders zh navigation and locale roots on the default locale home route", async () => {
    mock.module("next/navigation", () => ({
      usePathname: () => "/",
      useRouter: () => ({ push() {} }),
    }));

    const { SiteHeader } = await import("./site-header");
    const html = renderToStaticMarkup(<SiteHeader totalEntries={7} />);

    expect(html).toContain("首页");
    expect(html).toContain("曲库");
    expect(html).toContain("随机");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/charts"');
    expect(html).not.toContain('href="/search"');
    expect(html).toContain('aria-label="语言切换"');
    expect(html).toContain('aria-label="切换主题"');
  });

  test("static HTML is pinned for view transitions and starts expanded", async () => {
    mock.module("next/navigation", () => ({
      usePathname: () => "/",
      useRouter: () => ({ push() {} }),
    }));

    const { SiteHeader } = await import("./site-header");
    const html = renderToStaticMarkup(<SiteHeader totalEntries={7} />);

    // The chrome stays put during the branded page transition (globals.css).
    expect(html).toContain("view-transition-name:site-header");
    // Compact-on-scroll is a client behavior: the prerendered HTML must carry
    // the expanded paddings and never hide the tagline.
    expect(html).toContain("py-3");
    expect(html).not.toContain("py-1.5");
    expect(html).not.toContain("opacity:0");
  });
});
