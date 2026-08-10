import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  compositeOver,
  contrastRatio,
  oklchToSrgb,
  parseOklch,
  relativeLuminance,
  srgbFromOklchString,
  type Srgb,
} from "./color-contrast";
import { DIFFICULTY_TONE_CLASS, GENRES } from "./catalog-shared";

const globalsCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);

/** First value of `--token` inside the given selector block. */
function readToken(selector: string, token: string): string {
  const blockStart = globalsCss.indexOf(`${selector} {`);
  if (blockStart < 0) {
    throw new Error(`Missing selector ${selector} in globals.css`);
  }
  const block = globalsCss.slice(blockStart, globalsCss.indexOf("}", blockStart));
  const match = new RegExp(`--${token}:\\s*([^;]+);`).exec(block);
  if (!match) {
    throw new Error(`Missing --${token} in ${selector}`);
  }
  return match[1].trim();
}

function srgb(value: string): Srgb {
  const parsed = srgbFromOklchString(value);
  if (parsed === null) {
    throw new Error(`Not an oklch() colour: ${value}`);
  }
  return parsed;
}

/**
 * Tailwind v4's own palette values for the shades the badges use. They live in
 * the framework, not in our CSS, so they are pinned here — a Tailwind upgrade
 * that moved them would show up as a failure rather than as a silent
 * regression.
 */
const TAILWIND: Record<string, string> = {
  "emerald-500": "oklch(0.696 0.17 162.48)",
  "emerald-700": "oklch(0.508 0.118 165.612)",
  "amber-500": "oklch(0.769 0.188 70.08)",
  "amber-800": "oklch(0.473 0.137 46.201)",
  "rose-500": "oklch(0.645 0.246 16.439)",
  "rose-700": "oklch(0.514 0.222 16.935)",
  "violet-500": "oklch(0.606 0.25 292.717)",
  "violet-700": "oklch(0.491 0.27 292.581)",
  "fuchsia-400": "oklch(0.74 0.238 322.16)",
  "fuchsia-700": "oklch(0.518 0.253 323.949)",
  "pink-500": "oklch(0.656 0.241 354.308)",
  "pink-700": "oklch(0.525 0.223 3.958)",
  "sky-500": "oklch(0.685 0.169 237.323)",
  "sky-700": "oklch(0.5 0.134 242.749)",
  "cyan-500": "oklch(0.715 0.143 215.221)",
  "cyan-700": "oklch(0.52 0.105 223.128)",
  "red-500": "oklch(0.637 0.237 25.331)",
  "red-700": "oklch(0.505 0.213 27.518)",
};

/**
 * `border-x-500/40 bg-x-500/12 text-x-700 dark:...` → the light-mode text and
 * tint pair the badge actually renders. Only the light branch is checked: dark
 * mode measures 7.8–11.7:1 already.
 */
function lightBadgeColors(classes: string): { text: string; tintAlpha: number; tint: string } {
  const text = /(?:^|\s)text-([a-z]+-\d{3})(?:\s|$)/.exec(classes);
  const background = /(?:^|\s)bg-([a-z]+-\d{3})\/(\d+)(?:\s|$)/.exec(classes);
  if (!text || !background) {
    throw new Error(`Unrecognised badge classes: ${classes}`);
  }
  return {
    text: text[1],
    tint: background[1],
    tintAlpha: Number(background[2]) / 100,
  };
}

function badgeContrast(classes: string, surface: Srgb): number {
  const { text, tint, tintAlpha } = lightBadgeColors(classes);
  const textColor = TAILWIND[text];
  const tintColor = TAILWIND[tint];
  if (!textColor || !tintColor) {
    throw new Error(`Unpinned Tailwind shade in: ${classes}`);
  }
  return contrastRatio(
    srgb(textColor),
    compositeOver(srgb(tintColor), surface, tintAlpha)
  );
}

describe("color-contrast math", () => {
  test("parses both the plain and the slashed oklch forms", () => {
    expect(parseOklch("oklch(0.52 0.15 259)")).toEqual({
      l: 0.52,
      c: 0.15,
      h: 259,
      alpha: 1,
    });
    expect(parseOklch("oklch(1 0 0 / 10%)")).toEqual({
      l: 1,
      c: 0,
      h: 0,
      alpha: 0.1,
    });
    expect(parseOklch("rgb(0 0 0)")).toBeNull();
  });

  test("converts the achromatic anchors to sRGB black and white", () => {
    const white = oklchToSrgb(1, 0, 0);
    const black = oklchToSrgb(0, 0, 0);
    expect(white.r).toBeCloseTo(1, 2);
    expect(white.g).toBeCloseTo(1, 2);
    expect(white.b).toBeCloseTo(1, 2);
    expect(relativeLuminance(black)).toBeCloseTo(0, 4);
    // The definitional maximum: white on black is exactly 21:1.
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
  });

  test("compositing a translucent tint moves toward the surface underneath", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 1, g: 1, b: 1 };
    expect(compositeOver(black, white, 0.5)).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(compositeOver(black, white, 0)).toEqual(white);
  });
});

describe("design token contrast", () => {
  const lightBackground = srgb(readToken(":root", "background"));
  const lightCard = srgb(readToken(":root", "card"));

  test("the light-mode focus ring clears 3:1 against the page and card surfaces", () => {
    // WCAG 2.2 1.4.11: a focus indicator is a non-text UI component.
    const ring = srgb(readToken(":root", "ring"));
    expect(contrastRatio(ring, lightBackground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ring, lightCard)).toBeGreaterThanOrEqual(3);
  });

  test("every accent preset keeps a 3:1 focus ring in light mode", () => {
    for (const accent of ["violet", "teal", "orange", "rose"]) {
      const ring = srgb(readToken(`:root[data-accent="${accent}"]`, "ring"));
      expect(contrastRatio(ring, lightBackground)).toBeGreaterThanOrEqual(3);
    }
  });

  test("difficulty pills clear 4.5:1 on the light surface", () => {
    // 12px/600 is below the large-text threshold, so the 3:1 exemption does not
    // apply to any of these.
    for (const [tone, classes] of Object.entries(DIFFICULTY_TONE_CLASS)) {
      if (tone === "default") {
        continue;
      }
      expect(badgeContrast(classes, lightCard)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("genre badges clear 4.5:1 on the light surface", () => {
    for (const genre of Object.values(GENRES)) {
      expect(badgeContrast(genre.badge, lightCard)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
