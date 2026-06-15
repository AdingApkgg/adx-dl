const MAX_FILENAME_ID_LENGTH = 80;

/** Sanitize an arbitrary chart identifier (slug/title) into a filename-safe token. */
export function sanitizeFilenameId(raw: string): string {
  const safe = raw
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FILENAME_ID_LENGTH);
  return safe || "chart";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
