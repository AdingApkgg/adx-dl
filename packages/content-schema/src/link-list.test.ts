import { describe, expect, test } from "bun:test";

import { validateLinkListFile } from "./link-list";

const SPECS = [
  { key: "contactChannels", requireDescription: false },
  { key: "communityChannels", requireDescription: true },
] as const;

function entry(over: Record<string, unknown> = {}) {
  return {
    name: { zh: "群", en: "Group", ja: "グループ" },
    url: "https://example.com/",
    description: { zh: "说明", en: "Desc", ja: "説明" },
    ...over,
  };
}

describe("validateLinkListFile", () => {
  test("accepts a well-formed file", () => {
    const data = {
      contactChannels: [{ name: entry().name, url: "https://example.com/" }],
      communityChannels: [entry()],
    };
    expect(validateLinkListFile(data, SPECS)).toEqual({ ok: true });
  });

  test("rejects a missing locale, naming the exact path", () => {
    const data = {
      contactChannels: [{ name: { zh: "群", en: "Group" }, url: "https://example.com/" }],
      communityChannels: [entry()],
    };
    const result = validateLinkListFile(data, SPECS);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      errors: ["contactChannels[0].name.ja: 必须是非空字符串"],
    });
  });

  test("rejects whitespace-only text the same as a missing one", () => {
    const data = {
      contactChannels: [{ name: { zh: "  ", en: "Group", ja: "グループ" }, url: "https://example.com/" }],
      communityChannels: [entry()],
    };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: ["contactChannels[0].name.zh: 必须是非空字符串"],
    });
  });

  test("rejects a non-http protocol", () => {
    const data = {
      contactChannels: [{ name: entry().name, url: "javascript:alert(1)" }],
      communityChannels: [entry()],
    };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: ["contactChannels[0].url: 只允许 http/https，拿到的是 javascript:"],
    });
  });

  test("rejects an unparseable url", () => {
    const data = {
      contactChannels: [{ name: entry().name, url: "not a url" }],
      communityChannels: [entry()],
    };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: ["contactChannels[0].url: 不是合法的 URL"],
    });
  });

  test("requires description only where the spec says so", () => {
    const withoutDescription = { name: entry().name, url: "https://example.com/" };
    const data = {
      contactChannels: [withoutDescription],
      communityChannels: [withoutDescription],
    };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: ["communityChannels[0].description: 必须是对象"],
    });
  });

  test("rejects a description on an array that must not carry one", () => {
    const data = {
      contactChannels: [entry()],
      communityChannels: [entry()],
    };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: ["contactChannels[0].description: 这个数组的条目不带 description"],
    });
  });

  test("rejects unknown entry keys and unknown locale keys", () => {
    const data = {
      contactChannels: [{ name: entry().name, url: "https://example.com/", icon: "x" }],
      communityChannels: [entry({ name: { zh: "群", en: "G", ja: "グ", ko: "그룹" } })],
    };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: [
        "contactChannels[0].icon: 不认识的字段",
        "communityChannels[0].name.ko: 不认识的语言键",
      ],
    });
  });

  test("rejects an empty array — an empty page is never an intended edit", () => {
    const data = { contactChannels: [], communityChannels: [entry()] };
    expect(validateLinkListFile(data, SPECS)).toMatchObject({
      ok: false,
      errors: ["contactChannels: 至少要有一个条目"],
    });
  });

  test("rejects a missing or extra top-level array", () => {
    expect(validateLinkListFile({ communityChannels: [entry()] }, SPECS)).toMatchObject({
      ok: false,
      errors: ["contactChannels: 必须是数组"],
    });
    expect(
      validateLinkListFile(
        { contactChannels: [entry({ description: undefined })], communityChannels: [entry()], extra: [] },
        SPECS
      )
    ).toMatchObject({ ok: false, errors: ["extra: 不认识的字段"] });
  });

  test("reports every problem at once, not just the first", () => {
    const data = {
      contactChannels: [{ name: {}, url: "" }],
      communityChannels: [entry()],
    };
    const result = validateLinkListFile(data, SPECS);
    expect(result.ok).toBe(false);
    // 3 locales + the url
    expect((result as { errors: string[] }).errors).toHaveLength(4);
  });

  test("rejects a non-object payload", () => {
    expect(validateLinkListFile(null, SPECS)).toMatchObject({ ok: false, errors: ["顶层必须是对象"] });
    expect(validateLinkListFile([], SPECS)).toMatchObject({ ok: false, errors: ["顶层必须是对象"] });
  });
});
