import type { ChartTag } from "./charts";

/** PostgreSQL char_length and product limits count Unicode code points. */
export function chartPlainText(value: unknown, max: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Deliberately reject control characters before storing untrusted text.
  if (typeof value !== "string" || [...value].length > max || /[\u0000\uD800-\uDFFF]/u.test(value)) throw new RangeError("Invalid chart metadata");
  return value;
}
export function normalizeChartTags(values: unknown): ChartTag[] {
  if (!Array.isArray(values) || values.length > 64) throw new RangeError("Invalid tags");
  const tags = new Map<string, ChartTag>();
  for (const value of values) {
    if (typeof value !== "string" || value.length > 160) throw new RangeError("Invalid tag");
    const label = value.trim(), normalized = label.normalize("NFKC").trim(), key = normalized.replace(/[A-Z]/g, letter => letter.toLowerCase());
    if (!label || [...label].length > 20 || [...key].length > 20 || /[\p{Cc}\p{Cf}\uD800-\uDFFF\/\\]/u.test(label + normalized) || /(?:[a-z][a-z0-9+.-]*:|www\.|\p{L}[\p{L}\p{N}-]*\.\p{L}{2,}(?:[?#]|$))/iu.test(normalized)) throw new RangeError("Invalid tag");
    if (!tags.has(key)) tags.set(key, { key, label });
  }
  if (tags.size > 8) throw new RangeError("Invalid tags");
  return [...tags.values()];
}
