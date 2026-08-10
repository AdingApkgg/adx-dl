/**
 * WCAG contrast for the design tokens, computed from their oklch source.
 *
 * The palette is authored in oklch (globals.css and Tailwind's own colours),
 * but WCAG 2.x defines contrast on sRGB relative luminance — so a token cannot
 * be checked by eye or by lightness alone. These functions exist so the ratios
 * can be asserted in a unit test instead of rediscovered by a user who cannot
 * read the Expert pill.
 */

export type Srgb = { r: number; g: number; b: number };

/** `oklch(L C H)` / `oklch(L C H / A)`, with L as a 0–1 number or a percentage. */
export function parseOklch(
  value: string
): { l: number; c: number; h: number; alpha: number } | null {
  const match =
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(
      value.trim()
    );
  if (!match) {
    return null;
  }
  const readNumber = (raw: string): number =>
    raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  const l = readNumber(match[1]);
  const c = Number(match[2]);
  const h = Number(match[3]);
  const alpha = match[4] === undefined ? 1 : readNumber(match[4]);
  return [l, c, h, alpha].some((n) => !Number.isFinite(n))
    ? null
    : { l, c, h, alpha };
}

function gammaEncode(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** Oklab → linear sRGB → gamma-encoded sRGB (Björn Ottosson's matrices). */
export function oklchToSrgb(l: number, c: number, hDegrees: number): Srgb {
  const hRadians = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(hRadians);
  const b = c * Math.sin(hRadians);

  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: gammaEncode(4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone),
    g: gammaEncode(-1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone),
    b: gammaEncode(-0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone),
  };
}

export function srgbFromOklchString(value: string): Srgb | null {
  const parsed = parseOklch(value);
  return parsed === null ? null : oklchToSrgb(parsed.l, parsed.c, parsed.h);
}

/** Source-over compositing, the model the browser uses for a tinted background. */
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

export function contrastRatio(a: Srgb, b: Srgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
