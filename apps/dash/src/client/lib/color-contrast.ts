/**
 * WCAG 2.x contrast math for app.css's hex custom properties.
 *
 * Ported (and trimmed to what this app needs — hex, not oklch, since
 * app.css's tokens are plain hex) from apps/web/src/lib/color-contrast.ts
 * after a review round caught .dash-notice--ok/--bad failing 4.5:1 in
 * light mode and there was no test anywhere in this app to have caught it
 * first. See color-contrast.test.ts, which pins down every themed
 * text/background pairing app.css actually renders — that test is the
 * thing that's supposed to catch the next regression, not a human
 * re-deriving these numbers by eye.
 */

export type Srgb = { r: number; g: number; b: number }; // each channel 0..1

/** `#rgb`, `#rrggbb` (case-insensitive, leading `#` optional). */
export function hexToSrgb(hex: string): Srgb {
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
  if (short) {
    const [, r, g, b] = short;
    return {
      r: parseInt(r + r, 16) / 255,
      g: parseInt(g + g, 16) / 255,
      b: parseInt(b + b, 16) / 255,
    };
  }
  const long = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!long) throw new Error(`not a #rgb/#rrggbb color: ${hex}`);
  const [, r, g, b] = long;
  return { r: parseInt(r, 16) / 255, g: parseInt(g, 16) / 255, b: parseInt(b, 16) / 255 };
}

/**
 * Source-over compositing, the model the browser uses for
 * `color-mix(in srgb, <color> P%, transparent)` painted over an opaque
 * background: that expression is equivalent to `<color>` at alpha=P%
 * (see the derivation in color-contrast.test.ts), which then gets
 * alpha-blended against whatever's behind it in the page.
 */
export function compositeOver(foreground: Srgb, background: Srgb, alpha: number): Srgb {
  const mix = (top: number, bottom: number): number => top * alpha + bottom * (1 - alpha);
  return {
    r: mix(foreground.r, background.r),
    g: mix(foreground.g, background.g),
    b: mix(foreground.b, background.b),
  };
}

export function relativeLuminance({ r, g, b }: Srgb): number {
  const linear = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1:1 (no contrast) to 21:1 (black on white). */
export function contrastRatio(a: Srgb, b: Srgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
