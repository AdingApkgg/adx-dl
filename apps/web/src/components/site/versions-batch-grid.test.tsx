import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { VersionGroup } from "@/lib/catalog-shared";
import { VersionsBatchGrid } from "./versions-batch-grid";

const groups: VersionGroup[] = [
  { slug: "maimai-dx-circle", name: "maimai DX CiRCLE", imageIndex: 25, count: 42 },
  { slug: "maimai", name: "maimai", imageIndex: 0, count: 0 },
  { slug: "unknown", name: "Unknown", imageIndex: null, count: 3 },
];

describe("VersionsBatchGrid", () => {
  test("prerenders the tile grid visible (no hidden reveal state in SSR HTML)", () => {
    const html = renderToStaticMarkup(<VersionsBatchGrid groups={groups} locale="zh" />);

    expect(html).toContain("maimai DX CiRCLE");
    // The grid must not be prerendered in a hidden (opacity: 0) motion state.
    expect(html).not.toContain("opacity:0");
  });

  test("links versions with charts and dims empty ones", () => {
    const html = renderToStaticMarkup(<VersionsBatchGrid groups={groups} locale="zh" />);

    expect(html).toContain('href="/versions/maimai-dx-circle"');
    expect(html).not.toContain('href="/versions/maimai"');
    expect(html).toContain('aria-disabled="true"');
  });
});
