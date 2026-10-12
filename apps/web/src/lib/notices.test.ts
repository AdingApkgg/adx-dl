import { describe, expect, test } from "bun:test";

import {
  isActive,
  isInternalNoticeHref,
  isSafeNoticeHref,
  latestNotice,
  parseNotices,
  pickBannerNotice,
  pruneIds,
  staleNoticeIds,
  resolveText,
  sortNotices,
  todayUtc,
  unreadCount,
  type Notice,
} from "@/lib/notices";

function buildNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: "n1",
    level: "normal",
    publishedAt: "2026-09-01",
    expiresAt: null,
    title: { zh: "标题", en: null, ja: null },
    body: { zh: "正文", en: null, ja: null },
    link: null,
    ...overrides,
  };
}

describe("todayUtc", () => {
  test("formats as a UTC calendar day, not a local one", () => {
    // 23:30 UTC on the 22nd is already the 23rd in UTC+9 — the UTC day must win.
    expect(todayUtc(new Date("2026-09-22T23:30:00Z"))).toBe("2026-09-22");
  });
});

describe("resolveText", () => {
  test("uses the translation when present", () => {
    const text = { zh: "中文", en: "English", ja: null };
    expect(resolveText(text, "en")).toEqual({ value: "English", translated: true });
  });

  test("falls back to zh and flags the gap", () => {
    const text = { zh: "中文", en: null, ja: null };
    expect(resolveText(text, "ja")).toEqual({ value: "中文", translated: false });
  });

  test("zh itself is never flagged as untranslated", () => {
    const text = { zh: "中文", en: null, ja: null };
    expect(resolveText(text, "zh")).toEqual({ value: "中文", translated: true });
  });
});

describe("isActive", () => {
  test("a null expiry never expires", () => {
    expect(isActive(buildNotice({ expiresAt: null }), "2030-01-01")).toBe(true);
  });

  test("the expiry day itself is still active", () => {
    expect(isActive(buildNotice({ expiresAt: "2026-09-23" }), "2026-09-23")).toBe(true);
  });

  test("the day after the expiry is not", () => {
    expect(isActive(buildNotice({ expiresAt: "2026-09-23" }), "2026-09-24")).toBe(false);
  });
});

describe("sortNotices", () => {
  test("active first (newest first), expired after (newest first)", () => {
    const list = [
      buildNotice({ id: "old-active", publishedAt: "2026-09-01" }),
      buildNotice({ id: "expired-new", publishedAt: "2026-09-20", expiresAt: "2026-09-21" }),
      buildNotice({ id: "new-active", publishedAt: "2026-09-10" }),
      buildNotice({ id: "expired-old", publishedAt: "2026-08-01", expiresAt: "2026-08-02" }),
    ];
    expect(sortNotices(list, "2026-09-23").map((notice) => notice.id)).toEqual([
      "new-active",
      "old-active",
      "expired-new",
      "expired-old",
    ]);
  });
});

describe("pickBannerNotice", () => {
  const urgent = buildNotice({ id: "u1", level: "urgent", publishedAt: "2026-09-10" });
  const newerUrgent = buildNotice({ id: "u2", level: "urgent", publishedAt: "2026-09-20" });
  const featured = buildNotice({ id: "f1", level: "featured", publishedAt: "2026-09-22" });
  const normal = buildNotice({ id: "n2", level: "normal", publishedAt: "2026-09-21" });

  test("picks the newest active urgent notice", () => {
    expect(pickBannerNotice([urgent, newerUrgent, normal], "2026-09-23", [], [])?.id).toBe("u2");
  });

  test("skips dismissed ids and falls through to the next one", () => {
    expect(pickBannerNotice([urgent, newerUrgent], "2026-09-23", ["u2"], [])?.id).toBe("u1");
  });

  test("ignores expired urgent notices", () => {
    const expired = buildNotice({ id: "u3", level: "urgent", expiresAt: "2026-09-01" });
    expect(pickBannerNotice([expired], "2026-09-23", [], [])).toBeNull();
  });

  test("never picks a normal notice", () => {
    expect(pickBannerNotice([normal], "2026-09-23", [], [])).toBeNull();
  });

  test("urgent beats a newer featured notice", () => {
    expect(pickBannerNotice([urgent, featured], "2026-09-23", [], [])?.id).toBe("u1");
  });

  test("an unread featured notice shows when no urgent one does", () => {
    expect(pickBannerNotice([featured, normal], "2026-09-23", [], [])?.id).toBe("f1");
  });

  test("a featured notice is gone once read, an urgent one is not", () => {
    expect(pickBannerNotice([featured], "2026-09-23", [], ["f1"])).toBeNull();
    expect(pickBannerNotice([urgent], "2026-09-23", [], ["u1"])?.id).toBe("u1");
  });

  test("a featured notice is gone once dismissed", () => {
    expect(pickBannerNotice([featured], "2026-09-23", ["f1"], [])).toBeNull();
  });
});

describe("latestNotice", () => {
  test("the newest active notice", () => {
    const list = [
      buildNotice({ id: "old", publishedAt: "2026-09-01" }),
      buildNotice({ id: "new", publishedAt: "2026-09-10" }),
    ];
    expect(latestNotice(list, "2026-09-23")?.id).toBe("new");
  });

  test("null when every notice has expired", () => {
    const list = [buildNotice({ id: "gone", expiresAt: "2026-09-01" })];
    expect(latestNotice(list, "2026-09-23")).toBeNull();
  });
});

describe("staleNoticeIds", () => {
  test("only notices published before the 14-day grace window", () => {
    const list = [
      buildNotice({ id: "edge", publishedAt: "2026-09-09" }),
      buildNotice({ id: "older", publishedAt: "2026-09-08" }),
      buildNotice({ id: "fresh", publishedAt: "2026-09-20" }),
    ];
    expect(staleNoticeIds(list, "2026-09-23")).toEqual(["older"]);
  });
});

describe("parseNotices", () => {
  const valid = {
    id: "ok-1",
    level: "featured",
    publishedAt: "2026-09-01",
    expiresAt: null,
    title: { zh: "标题", en: null, ja: null },
    body: { zh: "正文", en: null, ja: null },
    link: { href: "/charts", label: { zh: "去看看", en: null, ja: null } },
  };

  test("accepts a well-formed file", () => {
    expect(parseNotices({ notices: [valid] })).toHaveLength(1);
  });

  test("rejects an id that would split or break a URL fragment", () => {
    expect(() => parseNotices({ notices: [{ ...valid, id: "a,b" }] })).toThrow(/slug/);
  });

  test("rejects an unknown level", () => {
    expect(() => parseNotices({ notices: [{ ...valid, level: "loud" }] })).toThrow(/level/);
  });

  test("rejects a missing zh title", () => {
    const title = { zh: "", en: "Title", ja: null };
    expect(() => parseNotices({ notices: [{ ...valid, title }] })).toThrow(/title/);
  });

  test("rejects a malformed date", () => {
    expect(() => parseNotices({ notices: [{ ...valid, publishedAt: "9/1" }] })).toThrow(/publishedAt/);
  });

  test("rejects duplicate ids", () => {
    expect(() => parseNotices({ notices: [valid, valid] })).toThrow(/duplicate/);
  });

  test("the real notices.json parses", async () => {
    const raw = await import("@/data/notices.json");
    expect(() => parseNotices(raw.default)).not.toThrow();
  });
});

describe("isInternalNoticeHref", () => {
  test("a site path is internal", () => {
    expect(isInternalNoticeHref("/charts")).toBe(true);
  });

  test("a protocol-relative URL is another site", () => {
    expect(isInternalNoticeHref("//evil.example/x")).toBe(false);
  });

  test("an absolute URL is external", () => {
    expect(isInternalNoticeHref("https://example.com")).toBe(false);
  });
});

describe("unreadCount", () => {
  test("counts active notices not yet read", () => {
    const list = [buildNotice({ id: "a" }), buildNotice({ id: "b" })];
    expect(unreadCount(list, ["a"], "2026-09-23")).toBe(1);
  });

  test("expired notices are never unread — they are no longer news", () => {
    const list = [buildNotice({ id: "a", expiresAt: "2026-09-01" })];
    expect(unreadCount(list, [], "2026-09-23")).toBe(0);
  });
});

describe("pruneIds", () => {
  test("drops ids that no longer exist in the data", () => {
    expect(pruneIds(["a", "gone"], [buildNotice({ id: "a" })])).toEqual(["a"]);
  });
});

describe("isSafeNoticeHref", () => {
  test("accepts absolute https and http URLs", () => {
    expect(isSafeNoticeHref("https://example.com/post")).toBe(true);
    expect(isSafeNoticeHref("http://example.com/post")).toBe(true);
  });

  test("accepts protocol-relative and site-relative hrefs", () => {
    expect(isSafeNoticeHref("//example.com/post")).toBe(true);
    expect(isSafeNoticeHref("/notices")).toBe(true);
  });

  test("rejects javascript: and any other scheme", () => {
    expect(isSafeNoticeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeNoticeHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeNoticeHref("data:text/html,evil")).toBe(false);
    expect(isSafeNoticeHref("mailto:a@example.com")).toBe(false);
  });

  test("rejects a bare scheme-relative string with no leading slash", () => {
    expect(isSafeNoticeHref("example.com/post")).toBe(false);
  });
});
