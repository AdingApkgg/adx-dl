import { describe, expect, test } from "bun:test";

import { m } from "@/paraglide/messages.js";

import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import zh from "../../../messages/zh.json";

type MessageFile = Record<string, unknown>;

const files: Record<"zh" | "en" | "ja", MessageFile> = { zh, en, ja };

function messageKeys(file: MessageFile): string[] {
  return Object.keys(file)
    .filter((key) => key !== "$schema")
    .sort();
}

// 普通文案的参数写成 {name}（\{ 是转义，不算）；复数这类变体写法是数组，
// 参数声明在 declarations 里，形如 "input count"。
function placeholders(value: unknown): string[] {
  if (typeof value === "string") {
    return [...value.matchAll(/(?<!\\)\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
  }
  if (Array.isArray(value)) {
    const inputs = value.flatMap((variant: { declarations?: string[] }) =>
      (variant.declarations ?? [])
        .filter((declaration) => declaration.startsWith("input "))
        .map((declaration) => declaration.slice("input ".length).trim())
    );
    return [...new Set(inputs)].sort();
  }
  return [];
}

describe("文案文件", () => {
  test("三种语言的键完全相同", () => {
    const expected = messageKeys(files.zh);
    expect(messageKeys(files.en)).toEqual(expected);
    expect(messageKeys(files.ja)).toEqual(expected);
  });

  // 带大写字母或点的键会被 Paraglide 改名（homeTitle 会变成 hometitle1），调用时容易写错。
  test("键名只用小写字母、数字和下划线", () => {
    for (const key of messageKeys(files.zh)) {
      expect(key, key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test("每条文案都不为空，三种语言的参数相同", () => {
    for (const key of messageKeys(files.zh)) {
      for (const [locale, file] of Object.entries(files)) {
        const value = file[key];
        const filled = typeof value === "string" ? value.trim().length > 0 : Array.isArray(value);
        expect(filled, `${locale}:${key}`).toBe(true);
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(files.zh[key]));
      }
    }
  });
});

describe("编译产物", () => {
  test("按传入的语言取文案，参数会被替换", () => {
    // m.xxx() 返回带品牌的 LocalizedString（string 的子类型），和 bun:test 的
    // expect<T>().toBe(expected: T) 比较字符串字面量时对不上类型；String() 转回
    // 普通 string，运行时是恒等操作，不影响断言本身。
    expect(String(m.home_api_version({ version: 1 }, { locale: "zh" }))).toBe("接口版本 v1");
    expect(String(m.home_api_version({ version: 1 }, { locale: "en" }))).toBe("API v1");
    expect(String(m.site_name({}, { locale: "ja" }))).toBe("AstroDX コミュニティ");
  });
});
