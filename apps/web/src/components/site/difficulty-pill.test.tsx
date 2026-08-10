import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DifficultyPill } from "@/components/site/difficulty-pill";

describe("DifficultyPill", () => {
  test("leads with the display level the catalog filters speak", () => {
    // 13.7 is a chart constant; every filter in the browse UI calls it "13+",
    // and quoting the constant as the headline made the two disagree.
    const html = renderToStaticMarkup(
      <DifficultyPill difficulty={{ slot: 4, level: "13.7", designer: "" }} showConstant />
    );

    expect(html).toContain(">13+<");
    expect(html).toContain(">13.7<");
    // The full difficulty name is still announced first for screen readers.
    expect(html).toContain("Expert ");
  });

  test("omits the constant when it is the display level already", () => {
    const html = renderToStaticMarkup(
      <DifficultyPill difficulty={{ slot: 2, level: "7", designer: "" }} showConstant />
    );

    expect(html).toContain(">7<");
    expect(html.match(/>7</g)).toHaveLength(1);
  });

  test("shows the display level alone unless the constant is asked for", () => {
    const html = renderToStaticMarkup(
      <DifficultyPill difficulty={{ slot: 4, level: "13.7", designer: "" }} />
    );

    expect(html).toContain(">13+<");
    expect(html).not.toContain(">13.7<");
    // The raw value stays reachable on hover, where it costs no layout.
    expect(html).toContain('title="Expert 13.7"');
  });

  test("falls back to the raw value when it has no display form", () => {
    // UTAGE levels can be free-form; inventing a display level for them would
    // be worse than showing what the source says.
    const html = renderToStaticMarkup(
      <DifficultyPill difficulty={{ slot: 7, level: "？", designer: "" }} showConstant />
    );

    expect(html).toContain("？");
  });
});
