import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { locales } from "@/lib/i18n";
import { buildWebManifest, webManifestPath } from "@/lib/web-manifest";

describe("web manifest", () => {
  test("keeps Chrome's manifest install requirements without a service worker", () => {
    for (const locale of locales) {
      const manifest = buildWebManifest(locale);
      expect(manifest.name || manifest.short_name).toBeTruthy();
      expect(manifest.display).toBe("standalone");
      expect(new URL(manifest.start_url, "https://archive.example").pathname.startsWith(manifest.scope)).toBe(true);
      for (const size of [192, 512]) {
        const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}` && entry.purpose === "any");
        expect(icon).toBeDefined();
        const png = readFileSync(new URL(`../../public${icon!.src}`, import.meta.url));
        expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
      }
    }
  });

  test("each locale installs as its own app, launching into its own tree", () => {
    expect(buildWebManifest("zh")).toMatchObject({
      id: "/",
      start_url: "/",
      lang: "zh-CN",
    });
    expect(buildWebManifest("en")).toMatchObject({
      id: "/en",
      start_url: "/en",
      lang: "en",
    });
    expect(buildWebManifest("ja")).toMatchObject({
      id: "/ja",
      start_url: "/ja",
      lang: "ja",
    });
  });

  test("scope stays site-wide so cross-locale links stay in the installed window", () => {
    for (const locale of locales) {
      expect(buildWebManifest(locale).scope).toBe("/");
    }
  });

  test("install copy is localized, never left in another locale's language", () => {
    const names = locales.map((locale) => buildWebManifest(locale).name);
    expect(new Set(names).size).toBe(locales.length);

    const english = buildWebManifest("en");
    expect(english.name).toBe("ADX Chart Archive");
    // A Han character here would mean the zh copy leaked into the en manifest.
    expect(english.description).not.toMatch(/[一-鿿]/);
  });

  test("manifest paths sit inside their own tree", () => {
    expect(webManifestPath("zh")).toBe("/site.webmanifest");
    expect(webManifestPath("en")).toBe("/en/site.webmanifest");
    expect(webManifestPath("ja")).toBe("/ja/site.webmanifest");
  });
});
