/** All positions are chart seconds, including the engine's lead-in. */
export type PreviewRange = { start: number; end: number };
export const MIN_PREVIEW_RANGE = 0.5;
export const MAX_GIF_SECONDS = 15;
export const GIF_SIZE = 480;
export const GIF_FPS = 20;
export const MAX_GIF_BYTES = 32 * 1024 * 1024;
export type DensityKind = "tap" | "hold" | "slide" | "touch" | "break";
export type DensityBucket = Record<DensityKind, number> & { total: number };
export const DENSITY_COLORS: Record<DensityKind, string> = {
  tap: "#eab308", hold: "#f97316", slide: "#06b6d4", touch: "#3b82f6", break: "#ec4899",
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function normalizePreviewRange(range: PreviewRange, duration: number): PreviewRange | null {
  if (![range.start, range.end, duration].every(Number.isFinite) || duration <= 0) return null;
  if (duration <= MIN_PREVIEW_RANGE) return { start: 0, end: duration };
  const start = clamp(range.start, 0, duration - MIN_PREVIEW_RANGE);
  return { start, end: clamp(range.end, start + MIN_PREVIEW_RANGE, duration) };
}
export function initialPreviewRange(position: number, duration: number): PreviewRange | null {
  return normalizePreviewRange({ start: position, end: position + 8 }, duration);
}
export function loopPosition(position: number, range: PreviewRange): number {
  const length = range.end - range.start;
  if (length <= 0) return range.start;
  if (position < range.start) return range.start;
  return position >= range.end ? range.start + (position - range.start) % length : position;
}
export function gifFrameCount(range: PreviewRange, duration: number): number {
  const length = range.end - range.start;
  if (![range.start, range.end, duration].every(Number.isFinite) || duration <= 0 || range.start < 0 || range.end > duration || length <= 0 || length > MAX_GIF_SECONDS ||
    (length < MIN_PREVIEW_RANGE && !(range.start === 0 && range.end === duration && duration < MIN_PREVIEW_RANGE))) {
    throw new RangeError("Invalid GIF range");
  }
  return Math.ceil(length * GIF_FPS);
}
export function buildDensity(notes: readonly { type: string; timingMs: number }[], duration: number, maxBuckets = 160): DensityBucket[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const limit = Number.isFinite(maxBuckets) ? Math.floor(maxBuckets) : 160;
  const count = Math.max(1, Math.min(600, limit, Math.ceil(duration * 2)));
  const bins = Array.from({ length: count }, () => ({ tap: 0, hold: 0, slide: 0, touch: 0, break: 0, total: 0 }));
  for (const note of notes) {
    if (!Number.isFinite(note.timingMs) || note.timingMs < 0 || note.timingMs > duration * 1000) continue;
    const key: DensityKind | undefined = note.type === "break" ? "break"
      : ["tap", "simultaneous"].includes(note.type) ? "tap"
      : ["hold-start", "hold-start-simultaneous"].includes(note.type) ? "hold"
      : note.type === "slide" ? "slide"
      : ["touch", "touch-hold-start"].includes(note.type) ? "touch" : undefined;
    if (!key) continue;
    const bin = bins[Math.min(count - 1, Math.floor(note.timingMs / (duration * 1000) * count))]!;
    bin[key]++; bin.total++;
  }
  return bins;
}
