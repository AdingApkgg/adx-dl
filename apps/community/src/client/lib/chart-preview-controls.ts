export const PREVIEW_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export function previewPosition(anchor: number, elapsed: number, rate: number, duration: number): number {
  return Math.max(0, Math.min(duration, anchor + Math.max(0, elapsed) * rate));
}
/** Source offsets are media seconds; scheduling delay is wall-clock seconds. */
export function previewAudioStart(chartSeconds: number, bpm: number, firstMs: number, rate: number): { delay: number; offset: number } {
  const offset = chartSeconds - 240 / bpm + firstMs / 1000;
  return { delay: Math.max(0, -offset) / rate, offset: Math.max(0, offset) };
}
export function previewTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
