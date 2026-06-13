import { describe, expect, mock, test } from "bun:test";

mock.module("@/lib/catalog", () => {
  const catalog = {
    generated_at: "2026-06-12T00:00:00.000Z",
    total_entries: 42,
    categories: {
      Official: ["舞萌DX 2024", "舞萌DX 2025"],
    },
    entries: [],
  };

  return {
    readCatalog: async () => catalog,
    readCatalogEntries: async () => [],
    readEntryById: async () => undefined,
    readEntryByRouteSlug: async () => undefined,
    readRouteSlugs: async () => [],
  };
});

describe("root layout language", () => {
  test("default and localized root layouts render locale specific html lang", async () => {
    const { default: DefaultRootLayout } = await import("./(default)/layout");
    const { default: LocalizedRootLayout } = await import("./[locale]/layout");

    const zhLayout = await DefaultRootLayout({
      children: <div>zh</div>,
    });
    const enLayout = await LocalizedRootLayout({
      children: <div>en</div>,
      params: Promise.resolve({ locale: "en" }),
    });
    const jaLayout = await LocalizedRootLayout({
      children: <div>ja</div>,
      params: Promise.resolve({ locale: "ja" }),
    });

    expect(zhLayout.props.lang).toBe("zh-CN");
    expect(enLayout.props.lang).toBe("en");
    expect(jaLayout.props.lang).toBe("ja");
  });
});
