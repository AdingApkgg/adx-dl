import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RouteLoadingSkeleton } from "./route-loading";

// Counts the browse-grid card placeholders, which only the catalog shape has.
function cardCount(html: string): number {
  return html.split("aspect-square").length - 1;
}

describe("RouteLoadingSkeleton", () => {
  test("announces loading and hides the placeholder shapes from assistive tech", () => {
    const html = renderToStaticMarkup(<RouteLoadingSkeleton label="加载中" />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("加载中");
    expect(html).toContain('aria-hidden="true"');
  });

  test("catalog stands in for the browse layout: filter box plus a full card grid", () => {
    const html = renderToStaticMarkup(
      <RouteLoadingSkeleton label="Loading" variant="catalog" />
    );

    expect(html).toContain("max-w-7xl");
    // Matches CatalogBrowser's own grid so cards don't reflow on handoff.
    expect(html).toContain("md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6");
    expect(cardCount(html)).toBe(12);
  });

  test("detail stands in for the chart hero, not a card grid", () => {
    const html = renderToStaticMarkup(
      <RouteLoadingSkeleton label="Loading" variant="detail" />
    );

    expect(html).toContain("max-w-6xl");
    expect(html).toContain("lg:grid-cols-[260px_minmax(0,1fr)]");
    // One cover placeholder, and none of the browse grid.
    expect(cardCount(html)).toBe(1);
    expect(html).not.toContain("xl:grid-cols-6");
  });

  test("prose stands in for the narrow text pages", () => {
    const html = renderToStaticMarkup(
      <RouteLoadingSkeleton label="Loading" variant="prose" />
    );

    expect(html).toContain("max-w-3xl");
    expect(cardCount(html)).toBe(0);
    expect(html).not.toContain("xl:grid-cols-6");
  });

  test("defaults to the catalog shape", () => {
    const explicit = renderToStaticMarkup(
      <RouteLoadingSkeleton label="Loading" variant="catalog" />
    );

    expect(renderToStaticMarkup(<RouteLoadingSkeleton label="Loading" />)).toBe(explicit);
  });
});
