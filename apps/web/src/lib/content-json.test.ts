import { describe, expect, test } from "bun:test";

import { CONTENT_FILES, CONTENT_LOCALES, validateContentFile } from "@astrodx/content-schema";

import community from "@content/community.json";
import { QQ_COMMUNITY, SITE_ISSUES_URL, TELEGRAM_COMMUNITY } from "@/lib/community-links";
import { locales } from "@/lib/i18n";

const BY_KEY: Record<string, unknown> = {
  community,
};

describe("content JSON matches its schema", () => {
  // Only the files migrated so far are asserted here; Task 2 adds the rest.
  test.each(Object.keys(BY_KEY))("%s validates", (key) => {
    expect(validateContentFile(key, BY_KEY[key])).toEqual({ ok: true });
  });

  test("every registered file that is imported here is registered", () => {
    for (const key of Object.keys(BY_KEY)) {
      expect(CONTENT_FILES.some((file) => file.key === key)).toBe(true);
    }
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

describe("constants that were inlined into JSON have not drifted", () => {
  // Migrating the arrays to JSON turned `url: SITE_ISSUES_URL` into a literal.
  // The constant is still exported (other modules import it), so the same URL
  // now exists in two places. These assertions are what keeps them equal.
  test("community.json's URLs equal the exported constants", () => {
    const urls = community.contactChannels.map((channel) => channel.url);
    expect(urls).toContain(SITE_ISSUES_URL);
    expect(urls).toContain(QQ_COMMUNITY);
    expect(urls).toContain(TELEGRAM_COMMUNITY);
    expect(community.communityChannels.map((channel) => channel.url)).toEqual([
      QQ_COMMUNITY,
      TELEGRAM_COMMUNITY,
    ]);
  });
});
