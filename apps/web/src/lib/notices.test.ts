import { describe, expect, test } from "bun:test";

import {
  isActive,
  pickUrgentNotice,
  pruneIds,
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

describe("pickUrgentNotice", () => {
  const urgent = buildNotice({ id: "u1", level: "urgent", publishedAt: "2026-09-10" });
  const newerUrgent = buildNotice({ id: "u2", level: "urgent", publishedAt: "2026-09-20" });
  const normal = buildNotice({ id: "n2", level: "normal", publishedAt: "2026-09-21" });

  test("picks the newest active urgent notice", () => {
    expect(pickUrgentNotice([urgent, newerUrgent, normal], "2026-09-23", [])?.id).toBe("u2");
  });

  test("skips dismissed ids and falls through to the next one", () => {
    expect(pickUrgentNotice([urgent, newerUrgent], "2026-09-23", ["u2"])?.id).toBe("u1");
  });

  test("ignores expired urgent notices", () => {
    const expired = buildNotice({ id: "u3", level: "urgent", expiresAt: "2026-09-01" });
    expect(pickUrgentNotice([expired], "2026-09-23", [])).toBeNull();
  });

  test("never picks a normal notice", () => {
    expect(pickUrgentNotice([normal], "2026-09-23", [])).toBeNull();
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
