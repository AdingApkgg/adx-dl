import { describe, expect, test } from "bun:test";

import { htmlLang, ogLocale } from "./locale";

describe("语言代码对照", () => {
  test("htmlLang：中文写成 zh-CN", () => {
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("en")).toBe("en");
    expect(htmlLang("ja")).toBe("ja");
  });

  test("ogLocale：语言_地区", () => {
    expect(ogLocale("zh")).toBe("zh_CN");
    expect(ogLocale("en")).toBe("en_US");
    expect(ogLocale("ja")).toBe("ja_JP");
  });
});
