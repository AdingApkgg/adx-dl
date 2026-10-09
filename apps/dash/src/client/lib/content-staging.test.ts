import { describe, expect, test } from "bun:test";

import { loadStaging, pendingKeys, saveStaging, stageFile, unstageFile } from "./content-staging";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    _map: map,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {},
};

describe("loadStaging", () => {
  test("什么都没存过时返回 {}", () => {
    expect(loadStaging(fakeStorage())).toEqual({});
  });

  test("storage 抛错时返回 {}——隐私模式不该把页面弄崩", () => {
    expect(loadStaging(throwingStorage)).toEqual({});
  });

  test("storage 是 null 时返回 {}（SSR / 没有 window）", () => {
    expect(loadStaging(null)).toEqual({});
  });

  test("JSON 格式损坏时返回 {}，而不是抛错", () => {
    expect(loadStaging(fakeStorage({ "dash:content-staging:v1": "{ not json" }))).toEqual({});
  });

  test("形状不像 StagedFile 的条目会被丢弃", () => {
    const stored = JSON.stringify({
      good: { data: { a: 1 }, baseSha: "s", editedAt: 1 },
      bad: { data: { a: 1 } },
      alsoBad: "nope",
    });
    expect(Object.keys(loadStaging(fakeStorage({ "dash:content-staging:v1": stored })))).toEqual(["good"]);
  });
});

describe("saveStaging", () => {
  test("经 storage 一来一回，数据不变", () => {
    const storage = fakeStorage();
    const staging = stageFile({}, "community", { a: 1 }, "sha1", 1000);
    saveStaging(staging, storage);
    expect(loadStaging(storage)).toEqual(staging);
  });

  test("会抛错的 storage 被吞掉——丢草稿好过崩页面", () => {
    expect(() => saveStaging(stageFile({}, "k", {}, "s", 1), throwingStorage)).not.toThrow();
  });

  test("空的暂存区会删掉那个 key，而不是存一个 {}", () => {
    const storage = fakeStorage({ "dash:content-staging:v1": "{}" });
    saveStaging({}, storage);
    expect(storage._map.has("dash:content-staging:v1")).toBe(false);
  });
});

describe("stageFile / unstageFile", () => {
  test("stageFile 不会修改传入的对象", () => {
    const before = {};
    const after = stageFile(before, "community", { a: 1 }, "sha1", 1000);
    expect(before).toEqual({});
    expect(after.community).toEqual({ data: { a: 1 }, baseSha: "sha1", editedAt: 1000 });
  });

  test("对同一个 key 暂存两次会整体替换并更新 editedAt", () => {
    const first = stageFile({}, "k", { a: 1 }, "sha1", 1000);
    const second = stageFile(first, "k", { a: 2 }, "sha2", 2000);
    expect(second.k).toEqual({ data: { a: 2 }, baseSha: "sha2", editedAt: 2000 });
    expect(Object.keys(second)).toHaveLength(1);
  });

  test("unstageFile 只删掉一个 key，其余原样保留", () => {
    const staging = stageFile(stageFile({}, "a", {}, "s", 1), "b", {}, "s", 2);
    expect(Object.keys(unstageFile(staging, "a"))).toEqual(["b"]);
  });

  test("撤销一个不存在的 key 是空操作，不是报错", () => {
    expect(unstageFile({}, "nope")).toEqual({});
  });
});

describe("pendingKeys", () => {
  test("结果是排过序的，横幅的顺序不依赖编辑顺序", () => {
    const staging = stageFile(stageFile({}, "zzz", {}, "s", 1), "aaa", {}, "s", 2);
    expect(pendingKeys(staging)).toEqual(["aaa", "zzz"]);
  });
});
