import { describe, expect, test } from "bun:test";

import { hasKana, kanaToRomaji, romajiForSearch } from "./romaji";

describe("kanaToRomaji", () => {
  test("handles plain hiragana and katakana identically", () => {
    expect(kanaToRomaji("さくら")).toBe("sakura");
    expect(kanaToRomaji("サクラ")).toBe("sakura");
  });

  test("prefers digraphs over the single-kana table", () => {
    expect(kanaToRomaji("きょう")).toBe("kyou");
    expect(kanaToRomaji("じゃあく")).toBe("jaaku");
    expect(kanaToRomaji("シャイニング")).toBe("shainingu");
  });

  test("geminates through the sokuon, with the tchi special case", () => {
    expect(kanaToRomaji("がっき")).toBe("gakki");
    expect(kanaToRomaji("いっしょ")).toBe("issho");
    expect(kanaToRomaji("まっちゃ")).toBe("matcha");
  });

  test("separates a syllabic n from a following vowel", () => {
    expect(kanaToRomaji("しんいち")).toBe("shin'ichi");
    expect(kanaToRomaji("しんじ")).toBe("shinji");
    expect(kanaToRomaji("せんよう")).toBe("sen'you");
  });

  test("lengthens on the prolonged sound mark", () => {
    expect(kanaToRomaji("スーパー")).toBe("suupaa");
    expect(kanaToRomaji("ラーメン")).toBe("raamen");
  });

  test("covers the extended katakana used in song titles", () => {
    expect(kanaToRomaji("ファイト")).toBe("faito");
    expect(kanaToRomaji("ヴァイオリン")).toBe("vaiorin");
    expect(kanaToRomaji("チェック")).toBe("chekku");
  });

  test("leaves kanji, Latin and punctuation in place", () => {
    expect(kanaToRomaji("恋するフォーチュン")).toBe("恋surufoochun");
    expect(kanaToRomaji("Hello ワールド!")).toBe("Hello waarudo!");
  });

  test("does not crash on kana that have nothing to attach to", () => {
    expect(kanaToRomaji("っ")).toBe("");
    expect(kanaToRomaji("ー")).toBe("");
    expect(kanaToRomaji("")).toBe("");
  });
});

describe("hasKana", () => {
  test("is true only when there is something to transliterate", () => {
    expect(hasKana("さくら")).toBe(true);
    expect(hasKana("サクラ")).toBe(true);
    expect(hasKana("provo")).toBe(false);
    expect(hasKana("東方妖々夢")).toBe(false);
    expect(hasKana("潘多拉")).toBe(false);
  });
});

describe("romajiForSearch", () => {
  test("returns an empty string when it would add no new search surface", () => {
    expect(romajiForSearch("Cosmic Train")).toBe("");
    expect(romajiForSearch("   ")).toBe("");
    expect(romajiForSearch("東方Project")).toBe("");
  });

  test("returns the Latin form for kana titles", () => {
    expect(romajiForSearch("シスターに懺悔を")).toBe("shisutaani懺悔wo");
    expect(romajiForSearch("ぼくらの16bit戦争")).toBe("bokurano16bit戦争");
  });
});
