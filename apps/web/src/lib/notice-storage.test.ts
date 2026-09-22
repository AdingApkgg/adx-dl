import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { notices as siteNotices, type Notice } from "@/lib/notices";
import {
  addDismissedId,
  isStorageAvailable,
  markRead,
  NOTICES_READ_EVENT,
  readDismissedIds,
  readReadIds,
  resetStorageAvailableForTests,
} from "@/lib/notice-storage";
// Reuses this file's fake-window harness rather than duplicating it: see the
// "unreadDotCount" describe block below for why these tests live here.
import {
  getUnreadNoticeCountSnapshot,
  subscribeUnreadNoticeCount,
  unreadDotCount,
} from "@/components/site/notices-unread-dot";

function buildNotice(id: string): Notice {
  return {
    id,
    level: "normal",
    publishedAt: "2026-09-01",
    expiresAt: null,
    title: { zh: "标题", en: null, ja: null },
    body: { zh: "正文", en: null, ja: null },
    link: null,
  };
}

const list = [buildNotice("a"), buildNotice("b")];

/**
 * Minimal in-memory Storage plus a real EventTarget, standing in for `window`.
 * `throwing` models Safari private mode. The EventTarget base (Bun provides
 * one as a global, no DOM needed) is what lets `subscribeUnreadNoticeCount`'s
 * `addEventListener`/`dispatchEvent`/`removeEventListener` calls work as-is.
 */
function installStorage({ throwing = false } = {}): void {
  const data = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      if (throwing) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (throwing) throw new Error("blocked");
      data.set(key, value);
    },
    removeItem(key: string): void {
      if (throwing) throw new Error("blocked");
      data.delete(key);
    },
  };
  const fakeWindow = Object.assign(new EventTarget(), { localStorage: storage });
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
}

beforeEach(() => {
  installStorage();
  // isStorageAvailable() memoizes at module scope; without resetting it here,
  // whichever test runs first would decide the answer for every test after it.
  resetStorageAvailableForTests();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  resetStorageAvailableForTests();
});

describe("dismissed ids", () => {
  test("round-trips through storage", () => {
    addDismissedId("a", list);
    expect(readDismissedIds(list)).toEqual(["a"]);
  });

  test("does not duplicate an id dismissed twice", () => {
    addDismissedId("a", list);
    addDismissedId("a", list);
    expect(readDismissedIds(list)).toEqual(["a"]);
  });

  test("prunes ids whose notice is gone", () => {
    addDismissedId("a", list);
    addDismissedId("b", list);
    expect(readDismissedIds([buildNotice("a")])).toEqual(["a"]);
  });

  test("blocked storage reads as empty rather than throwing", () => {
    installStorage({ throwing: true });
    expect(readDismissedIds(list)).toEqual([]);
  });

  test("blocked storage swallows writes", () => {
    installStorage({ throwing: true });
    expect(() => addDismissedId("a", list)).not.toThrow();
  });

  test("corrupt JSON reads as empty", () => {
    (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem(
      "adx-notice-dismissed",
      "{not json"
    );
    expect(readDismissedIds(list)).toEqual([]);
  });
});

describe("read ids", () => {
  test("markRead unions rather than replaces", () => {
    markRead(["a"], list);
    markRead(["b"], list);
    expect(readReadIds(list).sort()).toEqual(["a", "b"]);
  });
});

describe("isStorageAvailable", () => {
  test("true when storage works", () => {
    expect(isStorageAvailable()).toBe(true);
  });

  test("false when storage throws", () => {
    installStorage({ throwing: true });
    expect(isStorageAvailable()).toBe(false);
  });
});

// unreadDotCount (notices-unread-dot.tsx) is the composed function the dot
// actually calls: isStorageAvailable() gating unreadCount(readReadIds()).
// It lives in a "use client" component file with no JSX/hooks of its own, so
// it's a plain function safe to call directly here — imported rather than
// re-implemented so these tests exercise the exact code the dot ships, and
// placed in this file (not a new one) to reuse the fake-window harness above
// instead of duplicating it.
describe("unreadDotCount", () => {
  test("regression: blocked storage must yield 0, not every active notice marked unread", () => {
    installStorage({ throwing: true });
    expect(unreadDotCount(list)).toBe(0);
  });

  test("working storage with nothing read returns the active-notice count", () => {
    expect(unreadDotCount(list)).toBe(list.length);
  });

  test("working storage with every notice already read returns 0", () => {
    markRead(["a", "b"], list);
    expect(unreadDotCount(list)).toBe(0);
  });
});

// subscribeUnreadNoticeCount / getUnreadNoticeCountSnapshot (notices-unread-dot.tsx)
// back useUnreadNoticeCount's useSyncExternalStore. Both are plain functions,
// same rationale as unreadDotCount above: exercise the exact code the dot
// ships, reusing this file's fake-window harness rather than mounting anything
// (this repo has no DOM shim).
describe("subscribeUnreadNoticeCount", () => {
  test("notifies when markRead actually changes the read set", () => {
    let notifications = 0;
    const unsubscribe = subscribeUnreadNoticeCount(() => {
      notifications += 1;
    });

    markRead(["a"], list);

    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("does not notify when markRead is a no-op (id already read)", () => {
    markRead(["a"], list);
    let notifications = 0;
    const unsubscribe = subscribeUnreadNoticeCount(() => {
      notifications += 1;
    });

    markRead(["a"], list);

    expect(notifications).toBe(0);
    unsubscribe();
  });

  test("notifies on the native storage event, for another tab's write", () => {
    let notifications = 0;
    const unsubscribe = subscribeUnreadNoticeCount(() => {
      notifications += 1;
    });

    window.dispatchEvent(new Event("storage"));

    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("stops notifying once unsubscribed", () => {
    let notifications = 0;
    const unsubscribe = subscribeUnreadNoticeCount(() => {
      notifications += 1;
    });
    unsubscribe();

    markRead(["a"], list);
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event(NOTICES_READ_EVENT));

    expect(notifications).toBe(0);
  });
});

describe("getUnreadNoticeCountSnapshot", () => {
  test("agrees with unreadDotCount against the real default notice list", () => {
    expect(getUnreadNoticeCountSnapshot()).toBe(unreadDotCount());
  });

  test("goes to 0 after markRead marks every known notice read", () => {
    // Every id, not just the active ones — unreadCount() already ignores
    // expired notices either way, so this is a superset that stays correct
    // regardless of which real notices happen to be active right now.
    const allIds = siteNotices.map((notice) => notice.id);
    // Sanity check the test is actually exercising something: if this ever
    // reads 0 already, the assertion below would pass vacuously.
    expect(getUnreadNoticeCountSnapshot()).toBeGreaterThan(0);

    markRead(allIds);

    expect(getUnreadNoticeCountSnapshot()).toBe(0);
  });
});
