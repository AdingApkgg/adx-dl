/** The same pure parsing text is used for server summaries and private browser previews. */
export function normalizeChartMaidata(text: string): { text: string; legacy: boolean } {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("&")) return line;
    const equal = trimmed.indexOf("=");
    if (equal < 0) return trimmed; // Keep malformed metadata for the server's structural rejection.
    return `&${trimmed.slice(1, equal).trim().toLowerCase()}=${trimmed.slice(equal + 1)}`;
  });
  if (lines.some((line) => line.startsWith("&inote_"))) return { text: lines.join("\n"), legacy: false };
  const metadata = lines.filter((line) => line.startsWith("&"));
  const body = lines.filter((line) => !line.startsWith("&"));
  return { text: [...metadata, `&inote_4=${body.join("\n")}`].join("\n"), legacy: true };
}
