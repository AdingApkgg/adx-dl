import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { parseAccentColor, ThemeProvider, useTheme } from "./theme-provider";

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

  test("a choice made in this tab gives way to a later choice made in another tab", () => {
    function ChooseLight() {
      const { setTheme } = useTheme();
      return (
        <button type="button" onClick={() => setTheme("light")}>
          T-choose
        </button>
      );
    }
    render(
      <ThemeProvider>
        <ChooseLight />
      </ThemeProvider>
    );
    act(() => {
      screen.getByRole("button", { name: "T-choose" }).click();
    });
    expect(html.style.colorScheme).toBe("light");

    // This tab remembers "light" in memory; another tab then saves "dark".
    localStorage.setItem("theme", "dark");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
    });
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
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
    expect(listeners.size).toBeGreaterThan(0);
    expect(html.classList.contains("dark")).toBe(false);
    flipSystem(true);
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
    flipSystem(false);
    expect(html.classList.contains("dark")).toBe(false);
    unmount();
    expect(listeners.size).toBe(0);

    // An explicit choice wins over the system.
    localStorage.setItem("theme", "light");
    render(<ThemeProvider>content</ThemeProvider>);
    expect(listeners.size).toBeGreaterThan(0);
    flipSystem(true);
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });
});
