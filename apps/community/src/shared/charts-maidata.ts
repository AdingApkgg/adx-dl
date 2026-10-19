/** Same pure normalization for server admission, preview and derived analysis. */
export function normalizeChartMaidata(text: string): { text: string; legacy: boolean } {
  const result = normalize(text, false);
  return { text: result.text, legacy: result.legacy };
}
export type MappedMaidata = { text: string; legacy: boolean; offsets: Int32Array };
export function normalizeChartMaidataWithMap(text: string): MappedMaidata { return normalize(text, true); }
function normalize(source: string, mapped: boolean): MappedMaidata {
  const lines: { text: string; offsets: number[]; end: number }[] = [];
  let start = source.startsWith("\uFEFF") ? 1 : 0;
  while (start <= source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\r" && source[end] !== "\n") end++;
    let text = source.slice(start, end);
    let offsets = mapped ? Array.from({ length: text.length }, (_, i) => start + i) : [];
    const trimmed = text.trimStart();
    if (trimmed.startsWith("&")) {
      const leading = text.length - trimmed.length, equal = trimmed.indexOf("=");
      if (equal < 0) { text = trimmed; if (mapped) offsets = offsets.slice(leading); }
      else {
        const key = trimmed.slice(1, equal), keyLeading = key.length - key.trimStart().length;
        const normalizedKey = key.trim().toLowerCase();
        text = `&${normalizedKey}=${trimmed.slice(equal + 1)}`;
        if (mapped) offsets = [start + leading,
          ...Array.from({ length: normalizedKey.length }, (_, i) => start + leading + 1 + keyLeading + Math.min(i, key.trim().length - 1)),
          start + leading + equal, ...offsets.slice(leading + equal + 1)];
      }
    }
    lines.push({ text, offsets, end });
    if (end === source.length) break;
    start = end + (source[end] === "\r" && source[end + 1] === "\n" ? 2 : 1);
  }
  const legacy = !lines.some(line => line.text.startsWith("&inote_"));
  const ordered = legacy ? [...lines.filter(line => line.text.startsWith("&")),
    { text: "&inote_4=", offsets: Array(9).fill(-1), end: -1 }, ...lines.filter(line => !line.text.startsWith("&"))] : lines;
  let output = ""; const positions: number[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const line = ordered[i];
    // The synthetic legacy header directly prefixes the first body line.
    if (i && !(legacy && ordered[i - 1].end === -1)) {
      output += "\n"; if (mapped) positions.push(ordered[i - 1].end);
    }
    output += line.text; if (mapped) for (const offset of line.offsets) positions.push(offset);
  }
  return { text: output, legacy, offsets: Int32Array.from(positions) };
}
/** Columns count Unicode code points; CRLF is one line ending. */
export function originalPosition(source: string, offset: number): { line: number; column: number } | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return null;
  if (offset > 0 && /[\uDC00-\uDFFF]/.test(source[offset] ?? "") && /[\uD800-\uDBFF]/.test(source[offset - 1])) offset--;
  const before = source.slice(0, offset), lines = before.split(/\r\n|\r|\n/);
  return { line: lines.length, column: Array.from(lines.at(-1) ?? "").length + 1 };
}
