import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CONTENT_FILES, CONTENT_LOCALES, validateContentFile } from "@astrodx/content-schema";

import community from "@content/community.json";
import donate from "@content/donate.json";
import friendLinksJson from "@content/friend-links.json";
import { locales } from "@/lib/i18n";

const BY_KEY: Record<string, unknown> = {
  community,
  donate,
  "friend-links": friendLinksJson,
};

describe("content JSON matches its schema", () => {
  // Every content file registered in CONTENT_FILES is asserted here.
  test.each(Object.keys(BY_KEY))("%s validates", (key) => {
    expect(validateContentFile(key, BY_KEY[key])).toEqual({ ok: true });
  });

  test("every registered file that is imported here is registered", () => {
    for (const key of Object.keys(BY_KEY)) {
      expect(CONTENT_FILES.some((file) => file.key === key)).toBe(true);
    }
  });

  test("every registered content file is covered by this test", () => {
    // Catches a file added to CONTENT_FILES but never imported here — it would
    // otherwise ship unvalidated.
    expect(Object.keys(BY_KEY).sort()).toEqual(CONTENT_FILES.map((file) => file.key).sort());
  });
});

describe("the content package's locale list matches the site's", () => {
  // The two lists are written down separately — one for routing and
  // dictionaries, one for content validation. Nothing links them at the type
  // level, so this is the only thing that catches a fourth locale being added
  // to one and not the other.
  test("CONTENT_LOCALES equals i18n's locales", () => {
    expect([...CONTENT_LOCALES]).toEqual([...locales]);
  });
});

describe("content JSON is stored exactly as dash will write it", () => {
  // dash's content-commit endpoint serializes with `JSON.stringify(data, null, 2) + "\n"`
  // (see `serialize` in apps/dash/src/server/routes/content.ts). If the file on disk uses
  // a different layout, the first edit made through dash to any of these files produces a
  // whole-file whitespace diff that buries the real change underneath it. This test pins
  // the invariant that matters: the format on disk equals the format dash writes. If
  // `serialize` ever changes, these three files need to be regenerated together with it.
  for (const file of CONTENT_FILES) {
    test(`${file.key}.json is canonical`, () => {
      // file.path is repo-root relative. This test file lives at
      // apps/web/src/lib, four directories below the repo root — hence
      // "../../../..". `import.meta.dir` would be simpler but isn't declared
      // on this project's `ImportMeta` type (see bun-test.d.ts: `@types/bun`
      // is deliberately not pulled in), so this follows the same
      // `import.meta.url` + `URL` pattern color-contrast.test.ts already uses.
      const text = readFileSync(new URL(`../../../../${file.path}`, import.meta.url), "utf-8");
      expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    });
  }
});
