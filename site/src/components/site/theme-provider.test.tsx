import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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
});

