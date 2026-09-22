import { describe, expect, test } from "bun:test";

import { pickBanner } from "@/lib/site-banners";

describe("pickBanner", () => {
  test("nothing present means no banner", () => {
    expect(pickBanner({ connection: false, notice: false, locale: false })).toBeNull();
  });

  test("connection wins over everything — it is the most immediate fact", () => {
    expect(pickBanner({ connection: true, notice: true, locale: true })).toBe("connection");
  });

  test("an urgent notice wins over the locale suggestion", () => {
    expect(pickBanner({ connection: false, notice: true, locale: true })).toBe("notice");
  });

  test("the locale suggestion shows only when it is alone", () => {
    expect(pickBanner({ connection: false, notice: false, locale: true })).toBe("locale");
  });

  test("each one alone shows itself", () => {
    expect(pickBanner({ connection: true, notice: false, locale: false })).toBe("connection");
    expect(pickBanner({ connection: false, notice: true, locale: false })).toBe("notice");
  });
});
