import { describe, expect, test } from "bun:test";

import { LOCALE_PROMPT_STORAGE_KEY, preferredLocale, suggestedLocale } from "./locale-suggestion";

describe("浏览器偏好的站点语言", () => {
  test("取第一个主语言是 zh、en、ja 之一的，地区和大小写不管", () => {
    expect(preferredLocale(["en-US", "zh-CN"])).toBe("en");
    expect(preferredLocale(["fr-FR", "de", "ja-JP", "en"])).toBe("ja");
    expect(preferredLocale(["zh-TW"])).toBe("zh");
    expect(preferredLocale(["zh-Hant-HK"])).toBe("zh");
    expect(preferredLocale(["EN-gb"])).toBe("en");
  });

  test("一个都不是，或者列表是空的：null", () => {
    expect(preferredLocale(["fr-FR", "ko"])).toBeNull();
    expect(preferredLocale([])).toBeNull();
  });
});

describe("要不要提示切换语言", () => {
  test("偏好的语言和当前页面不一样：提示切到那种语言", () => {
    expect(suggestedLocale({ languages: ["en-US", "zh-CN"], current: "zh", dismissed: false })).toBe("en");
    expect(suggestedLocale({ languages: ["ja"], current: "en", dismissed: false })).toBe("ja");
  });

  test("一样，或者认不出偏好：不提示", () => {
    expect(suggestedLocale({ languages: ["zh-CN", "en"], current: "zh", dismissed: false })).toBeNull();
    expect(suggestedLocale({ languages: ["fr", "ko"], current: "zh", dismissed: false })).toBeNull();
  });

  test("用户关过提示（或者自己换过语言）：不再提示", () => {
    expect(suggestedLocale({ languages: ["en-US"], current: "zh", dismissed: true })).toBeNull();
  });

  test("存储键名", () => {
    expect(LOCALE_PROMPT_STORAGE_KEY).toBe("astrodx-locale-prompt");
  });
});
