import { describe, expect, test } from "bun:test";

import { isShortId, SHORT_ID_ALPHABET, shortId } from "./short-id";

describe("shortId", () => {
  test("默认 10 位，只用约定的字母表", () => {
    for (let i = 0; i < 200; i++) {
      expect(shortId()).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
    }
  });

  test("字母表去掉了容易看错的 0、1、i、l、o，共 31 个字符", () => {
    expect(SHORT_ID_ALPHABET).toHaveLength(31);
    for (const confusing of ["0", "1", "i", "l", "o"]) {
      expect(SHORT_ID_ALPHABET).not.toContain(confusing);
    }
  });

  // 31 不能整除 256，直接取模会让前 8 个字符多出现一点；用拒绝采样消掉这个偏差。
  test("每个字符出现的频率大致相同", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 6200; i++) {
      for (const char of shortId()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const expected = (6200 * 10) / 31;
    for (const char of SHORT_ID_ALPHABET) {
      const count = counts.get(char) ?? 0;
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.1);
    }
  });
});

describe("isShortId", () => {
  test("生成的 id 都认", () => {
    for (let i = 0; i < 50; i++) {
      expect(isShortId(shortId())).toBe(true);
    }
  });

  test("长度不对、有字母表以外的字符（大写、0、1、i、l、o、符号）都不认", () => {
    for (const value of ["abc234567", "abc23456789", "ABC2345678", "abc234567o", "abc234567l", "abc234567-", "", "abc2345678\n"]) {
      expect(isShortId(value), JSON.stringify(value)).toBe(false);
    }
  });
});
