import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Notice } from "@/lib/notices";
import {
  addDismissedId,
  markRead,
  readDismissedIds,
  readReadIds,
} from "@/lib/notice-storage";

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

/** Minimal in-memory Storage. `throwing` models Safari private mode. */
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
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
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
