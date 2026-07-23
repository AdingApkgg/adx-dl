import { describe, expect, mock, test } from "bun:test";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

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
    readRelatedEntries: async () => [],
    readRouteSlugs: async () => [],
    readCanonicalSlugs: async () => [],
    readVersionGroups: async () => [],
    readVersionGroup: async () => undefined,
    readVersionRouteIds: async () => [],
  };
});

describe("root layout language", () => {
  test("the shared app root owns global scripts across locale transitions", async () => {
    const { default: RootLayout } = await import("./layout");
    const layout = RootLayout({ children: <div>content</div> });
    const children = Children.toArray(
      (layout as ReactElement<{ children: ReactNode }>).props.children
    );
    const scriptIds = children.flatMap((child) =>
      isValidElement<{ id?: string }>(child) && child.props.id
        ? [child.props.id]
        : []
    );

    // The no-flash boot script is NOT here: React 19 rejects inline scripts
    // rendered outside the <html> tree, so it lives in RootLayoutShell.
    expect(scriptIds).toEqual(["speculation-rules"]);
  });

  test("the html-owning shell renders the boot script first in <body>", async () => {
    const { RootLayoutShell } = await import("./root-layout-shell");
    const shell = (await RootLayoutShell({
      children: <div>content</div>,
      lang: "zh-CN",
      locale: "zh",
    })) as ReactElement<{ children: ReactNode }>;

    expect(shell.type).toBe("html");
    const body = Children.toArray(shell.props.children).find(
      (child): child is ReactElement<{ children: ReactNode }> =>
        isValidElement(child) && child.type === "body"
    );
    expect(body).toBeDefined();

    // First body child, so it executes before any visible content parses.
    const [firstChild] = Children.toArray(body!.props.children);
    expect(isValidElement(firstChild) && firstChild.type).toBe("script");
    const script = firstChild as ReactElement<{
      id?: string;
      dangerouslySetInnerHTML?: { __html: string };
    }>;
    expect(script.props.id).toBe("theme-init");
    expect(script.props.dangerouslySetInnerHTML?.__html).toContain(
      "astrodx-music-player-prefs-v1"
    );
  });

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
