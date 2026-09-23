import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { compositeOver, contrastRatio, hexToSrgb, relativeLuminance, type Srgb } from "./color-contrast";

// Read app.css itself rather than hand-copying hex values into this file:
// a value pinned here by hand goes stale the moment someone edits app.css
// without also remembering to update a test three files away. This way the
// test always measures whatever app.css actually ships.
const appCss = readFileSync(new URL("../app.css", import.meta.url), "utf8");

/** The first `{...}` block opened by `${selector} {`, searching from `from`. */
function block(css: string, selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  if (start < 0) throw new Error(`Missing selector "${selector}" in app.css (from index ${from})`);
  const openBrace = css.indexOf("{", start);
  const closeBrace = css.indexOf("}", openBrace);
  return css.slice(openBrace, closeBrace);
}

function readVar(cssBlock: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(cssBlock);
  if (!match) throw new Error(`Missing --${name} in block: ${cssBlock.slice(0, 80)}...`);
  return match[1].trim();
}

const lightBlock = block(appCss, ":root");
const darkMediaStart = appCss.indexOf("@media (prefers-color-scheme: dark)");
if (darkMediaStart < 0) throw new Error("Missing the dark-mode @media block in app.css");
const darkBlock = block(appCss, ":root", darkMediaStart);

function tokens(cssBlock: string) {
  return {
    bg: hexToSrgb(readVar(cssBlock, "dash-bg")),
    ok: hexToSrgb(readVar(cssBlock, "dash-ok")),
    bad: hexToSrgb(readVar(cssBlock, "dash-bad")),
    running: hexToSrgb(readVar(cssBlock, "dash-running")),
    muted: hexToSrgb(readVar(cssBlock, "dash-muted")),
  };
}

const light = tokens(lightBlock);
const dark = tokens(darkBlock);

/**
 * `.dash-notice--ok`/`--bad` paint their background with
 * `color-mix(in srgb, var(--dash-ok|bad) 12%, transparent)`. Measured
 * directly against a real Chromium instance (not just derived from the CSS
 * Color 4 spec text): for `--dash-ok: #166a3f`, `getComputedStyle(...).
 * backgroundColor` for that rule came back as
 * `color(srgb 0.0862745 0.415686 0.247059 / 0.12)` — i.e. exactly
 * `rgba(22, 106, 63, 0.12)`, the source color's own channels untouched,
 * alpha scaled to the mix percentage. That's `compositeOver(color, bg,
 * 0.12)` composed with the identity step "extract rgba(color, alpha) first,
 * then flatten over bg" — the two are the same linear operation, so
 * modeling the whole thing as one `compositeOver` call is exact, not an
 * approximation.
 */
function noticeBackground(text: Srgb, pageBg: Srgb): Srgb {
  return compositeOver(text, pageBg, 0.12);
}

const AA_NORMAL_TEXT = 4.5;

describe("color-contrast math (sanity)", () => {
  test("black on white is the maximum, 21:1", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 })).toBeCloseTo(21, 1);
  });

  test("same color on itself is the minimum, 1:1", () => {
    const c = hexToSrgb("#166a3f");
    expect(contrastRatio(c, c)).toBeCloseTo(1, 6);
  });

  test("hexToSrgb accepts 3- and 6-digit forms, with or without '#'", () => {
    expect(hexToSrgb("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToSrgb("fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToSrgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  test("compositing at alpha=0 is a no-op; at alpha=1 it's the foreground", () => {
    const fg = hexToSrgb("#166a3f");
    const bg = hexToSrgb("#fbfbfd");
    expect(compositeOver(fg, bg, 0)).toEqual(bg);
    expect(compositeOver(fg, bg, 1)).toEqual(fg);
  });

  test("relativeLuminance of white is ~1, of black is 0", () => {
    expect(relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 4);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
  });
});

// Every text/background pairing app.css actually renders. This is the
// regression guard the review round that caught the original failure said
// this app was missing: apps/web has had color-contrast.test.ts from the
// start, apps/dash didn't, and that gap — not a one-off oversight — is why
// three light-mode pairings (.dash-notice--ok/--bad, .dash-pill--running)
// shipped under 4.5:1 in the first place.
describe(".dash-notice--ok / --bad (text + 12% color-mix background)", () => {
  test("light mode clears 4.5:1", () => {
    const okRatio = contrastRatio(light.ok, noticeBackground(light.ok, light.bg));
    const badRatio = contrastRatio(light.bad, noticeBackground(light.bad, light.bg));
    expect(okRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(badRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("dark mode clears 4.5:1", () => {
    const okRatio = contrastRatio(dark.ok, noticeBackground(dark.ok, dark.bg));
    const badRatio = contrastRatio(dark.bad, noticeBackground(dark.bad, dark.bg));
    expect(okRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(badRatio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

// .dash-pill--*, .dash-muted, and .dash-failure h2 all render their token
// directly as text color on the page background (no color-mix involved) —
// a more forgiving pairing than the notices above, but not automatically
// safe, as --dash-running's light-mode 3.15:1 demonstrated.
describe(".dash-pill--* / .dash-muted / .dash-failure h2 (text directly on page bg)", () => {
  test("light mode: ok/bad/running/muted all clear 4.5:1", () => {
    expect(contrastRatio(light.ok, light.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(light.bad, light.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(light.running, light.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(light.muted, light.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("dark mode: ok/bad/running/muted all clear 4.5:1", () => {
    expect(contrastRatio(dark.ok, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(dark.bad, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(dark.running, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(dark.muted, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
