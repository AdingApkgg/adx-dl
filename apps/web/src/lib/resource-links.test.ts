import { describe, expect, test } from "bun:test";

import { astroDxDownloadUrl, wikiUrl } from "@/lib/resource-links";

describe("resource links", () => {
  test("routes wiki pages through their locale segments", () => {
    expect(wikiUrl("zh")).toBe("https://wiki.astrodx.com/cn");
    expect(wikiUrl("en")).toBe("https://wiki.astrodx.com/en");
    expect(wikiUrl("ja")).toBe("https://wiki.astrodx.com/jp");
  });

  test("links each locale to a real game-download section", () => {
    expect(astroDxDownloadUrl("zh")).toBe(
      "https://wiki.astrodx.com/cn#%E4%B8%8B%E8%BD%BD%E6%B8%B8%E6%88%8F"
    );
    expect(astroDxDownloadUrl("en")).toBe(
      "https://wiki.astrodx.com/en#get-the-game"
    );
    expect(astroDxDownloadUrl("ja")).toBe(
      "https://wiki.astrodx.com/jp#%E8%AD%9C%E9%9D%A2%E3%81%AE%E5%85%A5%E3%82%8C%E6%96%B9"
    );
  });
});
