import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./button";

describe("Button", () => {
  test("renders a real button with variant classes and no hidden initial styles", () => {
    const html = renderToStaticMarkup(
      <Button variant="outline" size="sm">
        下载
      </Button>
    );
    expect(html).toContain("<button");
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('data-variant="outline"');
    expect(html).toContain("下载");
    // Press physics are gesture-only: nothing may serialize opacity/transform
    // into the static HTML.
    expect(html).not.toContain("opacity:0");
    expect(html).not.toContain("transform:");
  });

  test("asChild still merges onto the child element (Slot branch untouched)", () => {
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="https://example.com/charts">谱面</a>
      </Button>
    );
    expect(html).toContain("<a");
    expect(html).not.toContain("<button");
    expect(html).toContain('href="https://example.com/charts"');
    expect(html).toContain('data-slot="button"');
  });
});
