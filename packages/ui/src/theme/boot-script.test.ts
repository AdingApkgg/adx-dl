import { describe, expect, test } from "bun:test";

import { parseMotionMode } from "../motion";
import { MOTION_STORAGE_KEY } from "../motion/constants";
import { themeBootScript } from "./boot-script";
import { ACCENT_COLORS, ACCENT_STORAGE_KEY, THEME_STORAGE_KEY } from "./constants";
import { parseAccentColor } from "./theme-provider";

type Html = {
  classes: Set<string>;
  attributes: Set<string>;
  style: { colorScheme?: string };
  dataset: Record<string, string>;
};

// Runs the script against a fake <html>, localStorage and matchMedia: the only
// browser APIs it touches.
function run(
  stored: Record<string, string>,
  { prefersDark = false, storageThrows = false } = {}
): Html {
  const html: Html = { classes: new Set(), attributes: new Set(), style: {}, dataset: {} };
  const documentElement = {
    classList: {
      add: (name: string) => html.classes.add(name),
      toggle: (name: string, force: boolean) => (force ? html.classes.add(name) : html.classes.delete(name)),
    },
    style: html.style,
    dataset: html.dataset,
    toggleAttribute: (name: string, force: boolean) =>
      force ? html.attributes.add(name) : html.attributes.delete(name),
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("storage is disabled");
      return stored[key] ?? null;
    },
  };
  const window = { matchMedia: () => ({ matches: prefersDark }) };
  new Function("document", "localStorage", "window", themeBootScript())({ documentElement }, localStorage, window);
  return html;
}

describe("themeBootScript", () => {
  test("keeps the storage keys existing visitors already have", () => {
    expect(THEME_STORAGE_KEY).toBe("theme");
    expect(ACCENT_STORAGE_KEY).toBe("astrodx-accent");
    expect(MOTION_STORAGE_KEY).toBe("adx-reduce-motion");
  });

  test("an explicit light or dark mode wins, anything else follows the OS", () => {
    const cases: [string | undefined, boolean, boolean][] = [
      ["light", true, false],
      ["dark", false, true],
      ["system", true, true],
      ["system", false, false],
      [undefined, true, true],
      [undefined, false, false],
      ["solarized", false, false],
    ];
    for (const [stored, prefersDark, dark] of cases) {
      const html = run(stored === undefined ? {} : { [THEME_STORAGE_KEY]: stored }, { prefersDark });
      expect(html.classes.has("dark")).toBe(dark);
      expect(html.style.colorScheme).toBe(dark ? "dark" : "light");
    }
  });

  test("applies the same accent as ThemeProvider", () => {
    for (const stored of [undefined, ...ACCENT_COLORS, "system-purple", ""]) {
      const html = run(stored === undefined ? {} : { [ACCENT_STORAGE_KEY]: stored });
      expect(html.dataset.accent).toBe(parseAccentColor(stored ?? null));
    }
  });

  test("applies the same motion mode as MotionProvider, legacy 1/0 values included", () => {
    for (const stored of [undefined, "1", "0", "system", "on", "off", "unknown"]) {
      const html = run(stored === undefined ? {} : { [MOTION_STORAGE_KEY]: stored });
      const mode = parseMotionMode(stored ?? null);
      expect(html.dataset.motion).toBe(mode);
      expect(html.attributes.has("data-reduced-motion")).toBe(mode === "off");
    }
  });

  test("falls back to dark, blue and the OS motion setting when storage throws", () => {
    const html = run({}, { storageThrows: true });
    expect(html.classes.has("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
    expect(html.dataset.accent).toBe("blue");
    expect(html.dataset.motion).toBe("system");
    expect(html.attributes.has("data-reduced-motion")).toBe(false);
  });

  test("is safe to inline in a script tag", () => {
    expect(themeBootScript()).not.toContain("<");
  });
});
