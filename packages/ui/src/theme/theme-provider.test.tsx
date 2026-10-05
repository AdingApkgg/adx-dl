import { act, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { parseAccentColor, ThemeProvider } from "./theme-provider";

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

describe("ThemeProvider in the browser", () => {
  const html = document.documentElement;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("picks up a choice made in another tab", () => {
    localStorage.setItem("theme", "light");
    render(<ThemeProvider>content</ThemeProvider>);
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.dataset.accent).toBe("blue");

    // Another tab writes localStorage; this tab only hears a storage event.
    localStorage.setItem("theme", "dark");
    localStorage.setItem("astrodx-accent", "rose");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
    });
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
    expect(html.dataset.accent).toBe("rose");
  });

  test("follows the system's light or dark mode only while set to follow it", () => {
    // A stand-in for the OS setting that the test can flip.
    let systemDark = false;
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          media: query,
          get matches() {
            return systemDark;
          },
          addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        }) as unknown as MediaQueryList
    );
    const flipSystem = (dark: boolean) =>
      act(() => {
        systemDark = dark;
        for (const listener of listeners) listener();
      });

    const { unmount } = render(<ThemeProvider>content</ThemeProvider>);
    expect(html.classList.contains("dark")).toBe(false);
    flipSystem(true);
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
    flipSystem(false);
    expect(html.classList.contains("dark")).toBe(false);
    unmount();

    // An explicit choice wins over the system.
    localStorage.setItem("theme", "light");
    render(<ThemeProvider>content</ThemeProvider>);
    flipSystem(true);
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });
});
