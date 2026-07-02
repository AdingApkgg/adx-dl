/** Compact human-readable size for progress readouts ("45.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}
