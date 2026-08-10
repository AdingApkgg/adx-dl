import type { ChartExportRange } from "./export-chart-gif";

/**
 * The A–B section currently on repeat, or null when looping is off.
 *
 * A module-level ref rather than store state for the same reason as
 * `playbackTimeRef`: the render loop reads it every frame, and a subscription
 * would re-render the whole player on each toggle. The owner (chart-preview)
 * writes it from an effect and clears it on unmount; the reader (chart-canvas's
 * rAF loop) only ever reads.
 */
export const playbackLoopRef: { current: ChartExportRange | null } = { current: null };
