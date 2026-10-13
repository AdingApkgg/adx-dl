import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ScrollingLabel } from "./scrolling-label";

test("renders as spans, so it can sit inside a heading, with the full text in the title", () => {
  const html = renderToStaticMarkup(
    <h2>
      <ScrollingLabel text="maimai DX BUDDiES PLUS" className="text-sm" />
    </h2>
  );
  expect(html).not.toContain("<div");
  expect(html).toContain('title="maimai DX BUDDiES PLUS"');
  expect(html).toContain('class="text-sm"');
});

test("starts still and ellipsized until it has measured an overflow", () => {
  const html = renderToStaticMarkup(<ScrollingLabel text="物凄い勢いでけーねが物凄いうた" active />);
  expect(html).toContain("text-ellipsis");
  expect(html).not.toContain("data-marquee");
});
