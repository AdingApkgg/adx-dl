import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { VersionGroup } from "@/lib/catalog-shared";
import { buildSelectedVersionCharts, VersionsBatchGrid } from "./versions-batch-grid";

const groups: VersionGroup[] = [
  { slug: "maimai-dx-circle", name: "maimai DX CiRCLE", imageIndex: 25, count: 42 },
  { slug: "maimai-dx-prism-plus", name: "maimai DX PRiSM PLUS", imageIndex: 24, count: 36 },
  { slug: "maimai", name: "maimai", imageIndex: 0, count: 0 },
  { slug: "unknown", name: "Unknown", imageIndex: null, count: 3 },
];

describe("VersionsBatchGrid", () => {
  test("prerenders the tile grid visible (no hidden reveal state in SSR HTML)", () => {
    const html = renderToStaticMarkup(<VersionsBatchGrid groups={groups} locale="zh" />);

    expect(html).toContain("maimai DX CiRCLE");
    expect(html).toContain(">CiRCLE<");
    expect(html).not.toContain(">25 CiRCLE<");
    // The grid must not be prerendered in a hidden (opacity: 0) motion state.
    expect(html).not.toContain("opacity:0");
  });

  test("links versions with charts and dims empty ones", () => {
    const html = renderToStaticMarkup(<VersionsBatchGrid groups={groups} locale="zh" />);
    const enHtml = renderToStaticMarkup(<VersionsBatchGrid groups={groups} locale="en" />);

    // Every active tile deep-links the shared catalog with that version selected.
    expect(html).toContain('href="/charts?version=25"');
    expect(enHtml).toContain('href="/en/charts?version=25"');
    expect(html).toContain('href="/charts?version=unknown"');
    // The 0-chart "maimai" tile (id 0) is dimmed, not linked.
    expect(html).not.toContain('href="/charts?version=0"');
    expect(html).toContain('aria-disabled="true"');
  });

  test("uses the global version group folders for every selected version", () => {
    const specs = {
      "maimai-dx-circle": [
        { dir: "Same Song", files: [{ name: "maidata.txt", url: "/a" }], groupDir: "25 CiRCLE" },
      ],
      "maimai-dx-prism-plus": [
        {
          dir: "Same Song",
          files: [{ name: "maidata.txt", url: "/b" }],
          groupDir: "24 PRiSM PLUS",
        },
      ],
    };

    expect(buildSelectedVersionCharts(groups, specs, new Set(["maimai-dx-circle"]))).toEqual([
      { dir: "Same Song", files: [{ name: "maidata.txt", url: "/a" }], groupDir: "25 CiRCLE" },
    ]);

    expect(
      buildSelectedVersionCharts(groups, specs, new Set(["maimai-dx-circle", "maimai-dx-prism-plus"]))
    ).toEqual([
      {
        dir: "Same Song",
        files: [{ name: "maidata.txt", url: "/a" }],
        groupDir: "25 CiRCLE",
      },
      {
        dir: "Same Song",
        files: [{ name: "maidata.txt", url: "/b" }],
        groupDir: "24 PRiSM PLUS",
      },
    ]);
  });
});
