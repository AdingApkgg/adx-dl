import { describe, expect, test } from "bun:test";

import { BIO_MAX, bioLength, normalizeBio, parseBio } from "./bio";

describe("normalizeBio", () => {
  test("统一换行，去掉首尾空白；Tab 换成空格", () => {
    expect(normalizeBio("  第一行\r\n第二行\r第三行\t结束  \n")).toBe("第一行\n第二行\n第三行 结束");
  });

  test("去掉换行以外的控制字符、双向文字控制符、零宽空格和 BOM", () => {
    expect(normalizeBio("a\u0007b\u202Ec\u2066d\u200Be\uFEFFf")).toBe("abcdef");
  });

  test("连续的空行最多留一个", () => {
    expect(normalizeBio("上\n\n\n\n下")).toBe("上\n\n下");
  });

  // 家庭、职业这类组合表情靠零宽连接符拼起来，不能当成控制符去掉。
  test("保留零宽连接符", () => {
    expect(normalizeBio("👩‍💻")).toBe("👩‍💻");
  });

  test("空值和非字符串变成空串", () => {
    expect(normalizeBio(undefined)).toBe("");
    expect(normalizeBio(null)).toBe("");
  });
});

describe("parseBio", () => {
  test("最多 300 个字符，按码点数：300 个表情可以，301 个不行", () => {
    expect(BIO_MAX).toBe(300);
    expect(parseBio("😀".repeat(300))).toBe("😀".repeat(300));
    expect(parseBio("😀".repeat(301))).toBeNull();
  });

  // 首尾空白和去掉的字符不算长度：限制的是存下来的内容。
  test("长度按规整之后算", () => {
    expect(parseBio(`${" ".repeat(50)}${"a".repeat(300)}\u0007`)).toBe("a".repeat(300));
  });

  test("空简介是合法的（等于清空）", () => {
    expect(parseBio("   ")).toBe("");
  });

  test("bioLength 按码点数", () => {
    expect(bioLength("a😀\n")).toBe(3);
  });
});
