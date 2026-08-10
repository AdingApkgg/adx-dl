/**
 * Pure analysis over a parsed simai chart: note counts, playable span and BPM
 * range.
 *
 * Extracted from the enrichment script so the numbers the site quotes on every
 * chart page are covered by unit tests rather than living only inside a
 * one-shot build script.
 */
import type { Chart, Note } from "@lxns-network/maimai-chart-engine";

import type { CatalogNoteCounts } from "./catalog-shared";

export function emptyNoteCounts(): CatalogNoteCounts {
  return { tap: 0, hold: 0, slide: 0, touch: 0, touch_hold: 0, break: 0, total: 0 };
}

/**
 * Buckets are disjoint by construction, so `total` is exactly their sum.
 *
 * - `hold-end*` is the tail of a hold already counted at its start.
 * - The parser gives a BREAK tap its own `"break"` type rather than flagging a
 *   `"tap"`, so the two buckets never double count.
 * - A split slide (`1-2[8:1]*-3[8:1]`) is one note object carrying several
 *   judged paths, and the game scores each path — hence the segment count.
 */
export function countNotes(notes: readonly Note[]): CatalogNoteCounts {
  const counts = emptyNoteCounts();
  for (const note of notes) {
    switch (note.type) {
      case "tap":
      case "simultaneous":
        counts.tap += 1;
        break;
      case "break":
        counts.break += 1;
        break;
      case "hold-start":
      case "hold-start-simultaneous":
        counts.hold += 1;
        break;
      case "slide": {
        const paths = note.allSlideSegments?.length ?? 1;
        counts.slide += Math.max(1, paths);
        break;
      }
      case "touch":
        counts.touch += 1;
        break;
      case "touch-hold-start":
        counts.touch_hold += 1;
        break;
      default:
        // hold-end / hold-end-simultaneous / touch-hold-end: tails, not objects.
        break;
    }
  }
  counts.total =
    counts.tap + counts.hold + counts.slide + counts.touch + counts.touch_hold + counts.break;
  return counts;
}

/** Playable span: the last moment anything is still being judged, in ms. */
export function chartDurationMs(chart: Pick<Chart, "notes">): number {
  let end = 0;
  for (const note of chart.notes) {
    let noteEnd = note.timingMs;
    if (note.type === "slide") {
      noteEnd += (note.delayMs ?? 0) + (note.durationMs ?? 0);
    }
    if (noteEnd > end) end = noteEnd;
  }
  return Math.round(end);
}

/**
 * Charts carry BPM as free-form decimals, so a soflan section can arrive as
 * `290.001`. Printing that verbatim reads like a bug; snap to a whole number
 * when it is one in all but floating-point noise, otherwise keep one decimal.
 */
export function tidyBpm(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? rounded : Math.round(value * 10) / 10;
}

export function bpmRange(
  chart: Pick<Chart, "bpm" | "bpmEvents">
): { min: number; max: number } | null {
  const values = [chart.bpm, ...chart.bpmEvents.map((event) => event.bpm)]
    .filter((bpm): bpm is number => typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0)
    .map(tidyBpm);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}
