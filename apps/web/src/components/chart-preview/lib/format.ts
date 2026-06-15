export function formatChartTimeForFilename(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;

  return `${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s${String(
    milliseconds,
  ).padStart(3, "0")}ms`;
}

/** ms → mm:ss for the transport readout. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
