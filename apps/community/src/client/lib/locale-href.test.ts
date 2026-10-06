import { describe, expect, test } from "bun:test";

import { localeHref } from "./locale-href";

describe("同一页面在某种语言下的地址", () => {
  test("先去掉现有的语言前缀，再按目标语言加上；查询串照带", () => {
    for (const [path, zh, en, ja] of [
      ["/", "/", "/en/", "/ja/"],
      ["/en/", "/", "/en/", "/ja/"],
      ["/ja/u/x?tab=2", "/u/x?tab=2", "/en/u/x?tab=2", "/ja/u/x?tab=2"],
    ]) {
      expect([localeHref(path, "zh"), localeHref(path, "en"), localeHref(path, "ja")], path).toEqual([zh, en, ja]);
    }
  });

  // 浏览器里 //evil.com/x 这样的路径是合法的 location.pathname：拼出来的地址不能把人带到别的站。
  test("//evil.com/x：仍然是本站的路径", () => {
    expect([localeHref("//evil.com/x", "zh"), localeHref("//evil.com/x", "en"), localeHref("//evil.com/x", "ja")]).toEqual([
      "/x",
      "/en/x",
      "/ja/x",
    ]);
  });
});
