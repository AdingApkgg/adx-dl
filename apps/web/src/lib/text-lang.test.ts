import { describe, expect, test } from "bun:test";

import { japaneseTextLang } from "./text-lang";

describe("japaneseTextLang", () => {
  test("tags text containing kana", () => {
    expect(japaneseTextLang("系ぎて")).toBe("ja");
    expect(japaneseTextLang("パンドラ")).toBe("ja");
    // Halfwidth katakana appears in a handful of upstream titles.
    expect(japaneseTextLang("ﾎﾟｯﾌﾟﾝ")).toBe("ja");
  });

  test("leaves pure ASCII and pure Han untagged", () => {
    expect(japaneseTextLang("PANDORA PARADOXXX")).toBeUndefined();
    // Han-only is genuinely ambiguous: tagging it would push Chinese titles
    // into Japanese glyph forms, which is the same bug in reverse.
    expect(japaneseTextLang("極圏")).toBeUndefined();
    expect(japaneseTextLang("潘多拉")).toBeUndefined();
  });

  test("treats missing text as untagged", () => {
    expect(japaneseTextLang("")).toBeUndefined();
    expect(japaneseTextLang(null)).toBeUndefined();
    expect(japaneseTextLang(undefined)).toBeUndefined();
  });
});
