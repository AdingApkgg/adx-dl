import { describe, expect, test } from "bun:test";

import { canonicalLink, localeAlternates, openGraph, originFrom } from "./seo";

const ORIGIN = "https://community.test";

describe("SEO 链接", () => {
  test("canonical 用完整地址，去掉末尾斜杠", () => {
    expect(canonicalLink(ORIGIN, "/en/charts/")).toEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://community.test/en/charts",
    });
  });

  test("三种语言加 x-default，互相链接", () => {
    expect(localeAlternates(ORIGIN, "/ja/charts")).toEqual([
      { tagName: "link", rel: "alternate", hrefLang: "zh-CN", href: "https://community.test/charts" },
      { tagName: "link", rel: "alternate", hrefLang: "en", href: "https://community.test/en/charts" },
      { tagName: "link", rel: "alternate", hrefLang: "ja", href: "https://community.test/ja/charts" },
      { tagName: "link", rel: "alternate", hrefLang: "x-default", href: "https://community.test/charts" },
    ]);
  });

  test("首页的互相链接不带末尾斜杠，和 canonical 一致", () => {
    expect(localeAlternates(ORIGIN, "/en").map((link) => link.href)).toEqual([
      "https://community.test/",
      "https://community.test/en",
      "https://community.test/ja",
      "https://community.test/",
    ]);
    expect(canonicalLink(ORIGIN, "/en/").href).toBe("https://community.test/en");
  });

  test("originFrom 从路由匹配里取根 loader 给的站点地址", () => {
    const matches = [
      { id: "root", loaderData: { requestId: "req-1", origin: ORIGIN } },
      { id: "routes/home", loaderData: {} },
    ];
    expect(originFrom(matches)).toBe(ORIGIN);
    expect(originFrom([])).toBe("");
  });

  test("openGraph 输出基本字段，语言换成 og:locale 的写法", () => {
    expect(
      openGraph({ title: "T", description: "D", url: "https://community.test/ja", locale: "ja", siteName: "S" })
    ).toEqual([
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "S" },
      { property: "og:title", content: "T" },
      { property: "og:description", content: "D" },
      { property: "og:url", content: "https://community.test/ja" },
      { property: "og:locale", content: "ja_JP" },
    ]);
  });
});
