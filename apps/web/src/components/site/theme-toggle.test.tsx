import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

describe("ThemeToggle", () => {
  test("renders deterministically on server for hydration", async () => {
    const { ThemeToggle } = await import("./theme-toggle");
    const labels = {
      toggleLabel: "Toggle theme",
      light: "Light",
      dark: "Dark",
      system: "System",
    };
    const html = renderToStaticMarkup(<ThemeToggle labels={labels} />);
    expect(html).toContain('aria-label="Toggle theme"');
  });
});
