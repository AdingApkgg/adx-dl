import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { parseAccentColor } from "./theme-provider";

describe("ThemeProvider", () => {
  test("does not render script tags in the React tree", async () => {
    const { ThemeProvider } = await import("./theme-provider");
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>
    );

    expect(html).not.toContain("<script");
  });

  test("accepts only supported accent presets", () => {
    expect(parseAccentColor("violet")).toBe("violet");
    expect(parseAccentColor("teal")).toBe("teal");
    expect(parseAccentColor("system-purple")).toBe("blue");
    expect(parseAccentColor(null)).toBe("blue");
  });
});
