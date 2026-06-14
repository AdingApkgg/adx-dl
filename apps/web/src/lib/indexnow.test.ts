import { describe, expect, test } from "bun:test";

import {
  getOptionalIndexNowConfig,
  assertValidIndexNowConfig,
  buildIndexNowKeyLocation,
  buildIndexNowPayload,
  buildIndexNowUrlList,
  normalizeSiteUrl,
  resolveIndexNowKey,
} from "@/lib/indexnow";

describe("indexnow helpers", () => {
  test("resolveIndexNowKey falls back to the committed default when unset or blank", () => {
    const fallback = resolveIndexNowKey(undefined);
    expect(fallback).toMatch(/^[a-zA-Z0-9-]{8,}$/);
    expect(resolveIndexNowKey("")).toBe(fallback);
    expect(resolveIndexNowKey("   ")).toBe(fallback);
    expect(resolveIndexNowKey(null)).toBe(fallback);
  });

  test("resolveIndexNowKey trims and prefers an explicit override", () => {
    expect(resolveIndexNowKey(" custom-key ")).toBe("custom-key");
  });

  test("normalizeSiteUrl trims trailing slash and preserves origin", () => {
    expect(normalizeSiteUrl("https://adxdls.saop.cc/")).toBe("https://adxdls.saop.cc");
    expect(normalizeSiteUrl("https://adxdls.saop.cc")).toBe("https://adxdls.saop.cc");
  });

  test("buildIndexNowUrlList expands default, prefixed, and detail routes in stable order", () => {
    expect(buildIndexNowUrlList("https://adxdls.saop.cc", ["e-1-a", "e-1-b"])).toEqual([
      "https://adxdls.saop.cc/",
      "https://adxdls.saop.cc/charts",
      "https://adxdls.saop.cc/versions",
      "https://adxdls.saop.cc/search",
      "https://adxdls.saop.cc/status",
      "https://adxdls.saop.cc/charts/e-1-a",
      "https://adxdls.saop.cc/charts/e-1-b",
      "https://adxdls.saop.cc/en",
      "https://adxdls.saop.cc/en/charts",
      "https://adxdls.saop.cc/en/versions",
      "https://adxdls.saop.cc/en/search",
      "https://adxdls.saop.cc/en/status",
      "https://adxdls.saop.cc/en/charts/e-1-a",
      "https://adxdls.saop.cc/en/charts/e-1-b",
      "https://adxdls.saop.cc/ja",
      "https://adxdls.saop.cc/ja/charts",
      "https://adxdls.saop.cc/ja/versions",
      "https://adxdls.saop.cc/ja/search",
      "https://adxdls.saop.cc/ja/status",
      "https://adxdls.saop.cc/ja/charts/e-1-a",
      "https://adxdls.saop.cc/ja/charts/e-1-b",
    ]);
  });

  test("buildIndexNowUrlList deduplicates incoming slugs", () => {
    const urls = buildIndexNowUrlList("https://adxdls.saop.cc", ["e-1-a", "e-1-a"]);

    expect(urls.filter((url) => url === "https://adxdls.saop.cc/charts/e-1-a")).toHaveLength(1);
    expect(urls.filter((url) => url === "https://adxdls.saop.cc/en/charts/e-1-a")).toHaveLength(1);
    expect(urls.filter((url) => url === "https://adxdls.saop.cc/ja/charts/e-1-a")).toHaveLength(1);
  });

  test("buildIndexNowUrlList keeps static routes before detail routes for every locale", () => {
    const urls = buildIndexNowUrlList("https://adxdls.saop.cc", ["e-1-a"]);

    expect(urls.indexOf("https://adxdls.saop.cc/status")).toBeLessThan(
      urls.indexOf("https://adxdls.saop.cc/charts/e-1-a")
    );
    expect(urls.indexOf("https://adxdls.saop.cc/en/status")).toBeLessThan(
      urls.indexOf("https://adxdls.saop.cc/en/charts/e-1-a")
    );
    expect(urls.indexOf("https://adxdls.saop.cc/ja/status")).toBeLessThan(
      urls.indexOf("https://adxdls.saop.cc/ja/charts/e-1-a")
    );
  });

  test("buildIndexNowKeyLocation points to the public key file", () => {
    expect(buildIndexNowKeyLocation("https://adxdls.saop.cc", "abc123")).toBe(
      "https://adxdls.saop.cc/indexnow-abc123.txt"
    );
  });

  test("buildIndexNowPayload derives host and keyLocation from the site URL", () => {
    expect(
      buildIndexNowPayload({
        siteUrl: "https://adxdls.saop.cc/",
        key: "abc123",
        urlList: ["https://adxdls.saop.cc/", "https://adxdls.saop.cc/charts"],
      })
    ).toEqual({
      host: "adxdls.saop.cc",
      key: "abc123",
      keyLocation: "https://adxdls.saop.cc/indexnow-abc123.txt",
      urlList: ["https://adxdls.saop.cc/", "https://adxdls.saop.cc/charts"],
    });
  });

  test("buildIndexNowPayload rejects a URL list from a different host", () => {
    expect(() =>
      buildIndexNowPayload({
        siteUrl: "https://adxdls.saop.cc",
        key: "abc123",
        urlList: ["https://example.com/charts"],
      })
    ).toThrow("must belong to host adxdls.saop.cc");
  });

  test("assertValidIndexNowConfig rejects empty site URL and key", () => {
    expect(() => assertValidIndexNowConfig({ siteUrl: "", key: "abc123" })).toThrow(
      "INDEXNOW_SITE_URL is required"
    );
    expect(() =>
      assertValidIndexNowConfig({ siteUrl: "https://adxdls.saop.cc", key: "" })
    ).toThrow("INDEXNOW_KEY is required");
  });

  test("getOptionalIndexNowConfig returns null when site URL or key is missing", () => {
    expect(getOptionalIndexNowConfig({ siteUrl: "", key: "abc123" })).toBeNull();
    expect(getOptionalIndexNowConfig({ siteUrl: "https://adxdls.saop.cc", key: "" })).toBeNull();
  });

  test("getOptionalIndexNowConfig returns normalized config when both values are present", () => {
    expect(
      getOptionalIndexNowConfig({
        siteUrl: " https://adxdls.saop.cc/ ",
        key: " abc123 ",
      })
    ).toEqual({
      siteUrl: "https://adxdls.saop.cc",
      key: "abc123",
    });
  });
});
