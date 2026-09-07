import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildPackableAliasIndex,
  MAX_PACKABLE_ALIAS_CHARS,
  MAX_PACKABLE_ALIASES,
  packableAliases,
  parsePackableAliasIndex,
} from "./maidata-aliases";

describe("packableAliases", () => {
  test("drops aliases that merely repeat the title", () => {
    expect(
      packableAliases("Tell Your World", [
        "告诉你的世界",
        "tell your world",
        "Tell  Your World",
        "tyw",
      ])
    ).toEqual(["告诉你的世界", "tyw"]);
  });

  test("ignores a kind-marker prefix on either side when comparing", () => {
    expect(packableAliases("[協]Love You", ["[協]love you", "love you", "xql"])).toEqual([
      "xql",
    ]);
  });

  test("drops aliases already contained in the title", () => {
    expect(
      packableAliases("Oshama Scramble! (Cranky Remix)", [
        "oshama scramble!",
        "cranky remix",
        "御坂",
      ])
    ).toEqual(["御坂"]);
  });

  test("drops aliases that could break a maidata line", () => {
    expect(packableAliases("Song", ["a&b", "line\nbreak", "tab\tbed", "ok"])).toEqual(["ok"]);
  });

  test("caps the list at five aliases", () => {
    expect(packableAliases("Song", ["a1", "a2", "a3", "a4", "a5", "a6"])).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
    ]);
  });

  test("skips overlong aliases instead of truncating them", () => {
    expect(packableAliases("Song", ["x".repeat(25), "short"])).toEqual(["short"]);
  });

  test("trims and dedupes case-insensitively, keeping the first spelling", () => {
    expect(packableAliases("Song", [" TYW ", "tyw", "Tyw", ""])).toEqual(["TYW"]);
  });

  test("returns an empty list without aliases", () => {
    expect(packableAliases("Song", undefined)).toEqual([]);
    expect(packableAliases("Song", [])).toEqual([]);
  });
});

describe("buildPackableAliasIndex", () => {
  test("keys packable aliases by shortid and drops entries left with none", () => {
    const index = buildPackableAliasIndex([
      { short_id: "100", title: "Tell Your World", aliases: ["告诉你的世界", "tell your world"] },
      { short_id: "70", title: "ジングルベル", aliases: ["ジングルベル"] },
      { short_id: "71", title: "No aliases" },
      { short_id: " ", title: "No id", aliases: ["nope"] },
    ]);

    expect(index).toEqual({ "100": ["告诉你的世界"] });
  });
});

describe("buildPackableAliasIndex over the real catalog", () => {
  test("keeps well over a thousand charts, every alias within the caps", async () => {
    // The same file the app reads at build time (apps/web → ../../data/catalog).
    const raw = await fs.readFile(
      path.resolve(process.cwd(), "..", "..", "data", "catalog", "index.json"),
      "utf-8"
    );
    const { entries } = JSON.parse(raw) as {
      entries: Parameters<typeof buildPackableAliasIndex>[0];
    };
    const index = buildPackableAliasIndex(entries);
    const ids = Object.keys(index);

    // 1457 of 1875 entries carry aliases; well over a thousand keep at least
    // one after the title-duplicate filter.
    expect(ids.length).toBeGreaterThan(1000);
    for (const id of ids) {
      expect(id).toMatch(/^\d+$/);
      const aliases = index[id]!;
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases.length).toBeLessThanOrEqual(MAX_PACKABLE_ALIASES);
      for (const alias of aliases) {
        expect(alias.length).toBeLessThanOrEqual(MAX_PACKABLE_ALIAS_CHARS);
        expect(alias).not.toContain("&");
      }
    }
  });
});

describe("parsePackableAliasIndex", () => {
  test("keeps only string-array values keyed by string", () => {
    expect(
      parsePackableAliasIndex({
        "100": ["告诉你的世界", 7, "tyw"],
        "70": "not a list",
        "71": [],
      })
    ).toEqual({ "100": ["告诉你的世界", "tyw"] });
  });

  test("yields an empty index for anything that is not an object", () => {
    expect(parsePackableAliasIndex(null)).toEqual({});
    expect(parsePackableAliasIndex(["x"])).toEqual({});
    expect(parsePackableAliasIndex("x")).toEqual({});
  });
});
