import { describe, expect, test } from "bun:test";

import { resolveSiteUrl } from "@/lib/site-url";

describe("resolveSiteUrl", () => {
  test("falls back to the default site URL when the env value is empty", () => {
    expect(resolveSiteUrl("")).toBe("https://adxdls.saop.cc");
    expect(resolveSiteUrl("   ")).toBe("https://adxdls.saop.cc");
  });

  test("preserves an explicit non-empty site URL", () => {
    expect(resolveSiteUrl("https://example.com")).toBe("https://example.com");
  });
});
