import { describe, expect, test } from "bun:test";

import {
  CATALOG_SELECTION_STORAGE_KEY,
  parseCatalogSelection,
  readCatalogSelection,
  writeCatalogSelection,
} from "./catalog-selection";

/** Minimal in-memory Storage stand-in; only the three methods we use. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

const known = new Set(["a", "b", "c"]);

describe("catalog-selection", () => {
  test("丢弃当前目录里已经不存在的 id（跨部署的陈旧选择）", () => {
    expect(parseCatalogSelection({ ids: ["a", "gone", "c"] }, known)).toEqual(["a", "c"]);
  });

  test("同时接受裸数组形式，并去重、保序", () => {
    expect(parseCatalogSelection(["c", "a", "c"], known)).toEqual(["c", "a"]);
  });

  test("脏输入一律退化成空选择而不是抛错", () => {
    expect(parseCatalogSelection(null, known)).toEqual([]);
    expect(parseCatalogSelection("a,b", known)).toEqual([]);
    expect(parseCatalogSelection({ ids: "a" }, known)).toEqual([]);
    expect(parseCatalogSelection({ ids: [1, null, { id: "a" }] }, known)).toEqual([]);
  });

  test("读到的不是合法 JSON 时静默返回空，不影响页面挂载", () => {
    const storage = fakeStorage({ [CATALOG_SELECTION_STORAGE_KEY]: "{not json" });
    expect(readCatalogSelection(storage, known)).toEqual([]);
  });

  test("写入后可原样读回", () => {
    const storage = fakeStorage();
    writeCatalogSelection(storage, ["b", "a"]);

    expect(readCatalogSelection(storage, known)).toEqual(["b", "a"]);
  });

  test("清空选择会删除键，否则下次进站会把刚取消的批次又装回来", () => {
    const storage = fakeStorage();
    writeCatalogSelection(storage, ["a"]);
    writeCatalogSelection(storage, []);

    expect(storage.map.has(CATALOG_SELECTION_STORAGE_KEY)).toBe(false);
    expect(readCatalogSelection(storage, known)).toEqual([]);
  });

  test("存储被禁用（getItem/setItem 抛错）时不会把异常抛给调用方", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readCatalogSelection(hostile, known)).toEqual([]);
    expect(() => writeCatalogSelection(hostile, ["a"])).not.toThrow();
    expect(() => writeCatalogSelection(hostile, [])).not.toThrow();
  });
});
