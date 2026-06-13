import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

describe("ThemeToggle", () => {
  test("renders deterministically on server for hydration", async () => {
    const { ThemeToggle } = await import("./theme-toggle");
    const html = renderToStaticMarkup(<ThemeToggle />);
    expect(html).toContain('aria-label="Switch to light mode"');
  });
});
