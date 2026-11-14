/** Five precomputed colour tokens; no image decoding is shipped to the browser. */
export type CoverPalette = {
  accent: string;
  highlight: string;
  surface: string;
  background: string;
  backgroundEnd: string;
};
type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const hex = (colour: RGB) =>
  `#${colour.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, weight: number): RGB =>
  a.map((v, i) => v * weight + b[i] * (1 - weight)) as RGB;
const luminance = (colour: string) =>
  rgb(colour)
    .map((v) => {
      const n = v / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrastRatio(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function derive(base: RGB): CoverPalette {
  let accent = hex(base),
    highlight = hex(mix(base, [255, 255, 255], 0.5));
  const background = hex(mix(base, [0, 0, 0], 0.24));
  for (let i = 0; contrastRatio(accent, "#ffffff") < 4.5 && i < 20; i++)
    accent = hex(mix(rgb(accent), [0, 0, 0], 0.9));
  for (let i = 0; contrastRatio(highlight, background) < 4.5 && i < 20; i++)
    highlight = hex(mix(rgb(highlight), [255, 255, 255], 0.8));
  return {
    accent,
    highlight,
    surface: hex(mix(base, [255, 255, 255], 0.07)),
    background,
    backgroundEnd: hex(mix(base, [0, 0, 0], 0.08)),
  };
}
export const DEFAULT_COVER_PALETTE: CoverPalette = derive([76, 100, 156]);
export function isCoverPalette(value: unknown): value is CoverPalette {
  if (!value || typeof value !== "object") return false;
  return ["accent", "highlight", "surface", "background", "backgroundEnd"].every((key) =>
    /^#[0-9a-f]{6}$/i.test(String((value as Record<string, unknown>)[key])),
  );
}
export function coverPaletteStyle(value?: unknown): Record<string, string> {
  const p = isCoverPalette(value) ? value : DEFAULT_COVER_PALETTE;
  return {
    "--cover-accent": p.accent,
    "--cover-highlight": p.highlight,
    "--cover-surface": p.surface,
    "--cover-background": p.background,
    "--cover-background-end": p.backgroundEnd,
  };
}
/** Quantise a tiny RGBA sample. Ignore transparent/near-white/near-black borders
 * and favour chromatic populations over the average of unrelated cover colours. */
export function paletteFromPixels(pixels: Uint8Array): CoverPalette {
  const buckets = new Map<number, { count: number; sum: RGB }>();
  const fallback: RGB = [0, 0, 0];
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const c: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]];
    total++;
    for (let k = 0; k < 3; k++) fallback[k] += c[k];
    const max = Math.max(...c),
      min = Math.min(...c);
    if (max < 32 || min > 232) continue;
    const key = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4);
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] as RGB };
    bucket.count++;
    for (let k = 0; k < 3; k++) bucket.sum[k] += c[k];
    buckets.set(key, bucket);
  }
  if (!total) return DEFAULT_COVER_PALETTE;
  let selected = fallback.map((v) => v / total) as RGB,
    best = -1;
  for (const b of buckets.values()) {
    const c = b.sum.map((v) => v / b.count) as RGB;
    const saturation = (Math.max(...c) - Math.min(...c)) / Math.max(1, ...c);
    const score = b.count * (0.15 + saturation);
    if (score > best) {
      best = score;
      selected = c;
    }
  }
  return derive(selected);
}
