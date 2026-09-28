import { describe, expect, test } from "bun:test";

import { NICKNAME_MAX, normalizeNickname } from "./nickname";

describe("normalizeNickname", () => {
  test("去掉首尾空白", () => {
    expect(normalizeNickname("  阿丁  ")).toBe("阿丁");
  });

  test("去掉控制字符和双向文字控制符", () => {
    expect(normalizeNickname("a\u0007b‮c⁦d​e﻿")).toBe("abcde");
  });

  // 按字符算，不按 UTF-16 码元：表情和生僻字各算一个。
  test("最多 24 个字符，截断后再去一次尾部空白", () => {
    expect(NICKNAME_MAX).toBe(24);
    expect(normalizeNickname("😀".repeat(30))).toBe("😀".repeat(24));
    expect(normalizeNickname(`${"a".repeat(23)} b`)).toBe("a".repeat(23));
  });

  test("空值和非字符串变成空串", () => {
    expect(normalizeNickname(undefined)).toBe("");
    expect(normalizeNickname(null)).toBe("");
    expect(normalizeNickname("\u0000\u0001")).toBe("");
  });

  // 家庭、职业这类组合表情靠零宽连接符拼起来，不能当成控制符去掉。
  test("保留零宽连接符", () => {
    expect(normalizeNickname("👩‍💻")).toBe("👩‍💻");
  });
});
