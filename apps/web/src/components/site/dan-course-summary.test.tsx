import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogCardEntry } from "@/lib/catalog-shared";
import { DAN_COURSES } from "@/lib/maimai-dan";
import { DanCourseSummary } from "./dan-course-summary";

const entry = (short_id: string, title: string): CatalogCardEntry => ({
  id: `chart-${short_id}`, slug: short_id, short_id, title, artist: "artist",
  category: "Remote", subcategory: "", version: "", genre: "", cabinet: "DX",
  bpm: null, media: { cover_url: "" },
  assets: { has_audio: true, has_background: true, has_pv: false, has_dx_chart: true },
  difficulties: [{ slot: 2, level: "2", designer: "" }, { slot: 5, level: "13+", designer: "" }],
});

describe("dan course summary", () => {
  test("shows prescribed difficulty and order even when input entries are reversed", () => {
    const html = renderToStaticMarkup(<DanCourseSummary course={DAN_COURSES[0]} entries={[
      entry("10319", "Third song"), entry("10256", "First song"),
    ]} locale="en" />);
    expect(html.indexOf("First song")).toBeLessThan(html.indexOf("Third song"));
    expect(html).toContain('href="/en/charts/10256"');
    expect(html).toContain("BAS");
    expect(html).not.toContain("13+");
    expect(html.match(/<li\b/g)).toHaveLength(4);
    expect(html).toContain("11052");
    expect(html).toContain("Outside this catalog");
    expect(html).not.toContain('href="/en/charts/11052"');
  });

  test("identifies the CN version and localizes true and ura course names", () => {
    const zh = renderToStaticMarkup(<DanCourseSummary course={DAN_COURSES[21]} entries={[]} locale="zh" />);
    const ja = renderToStaticMarkup(<DanCourseSummary course={DAN_COURSES[20]} entries={[]} locale="ja" />);
    expect(zh).toContain("舞萌DX 2026");
    expect(zh).toContain("里皆传");
    expect(ja).toContain("真皆伝");
  });
});
