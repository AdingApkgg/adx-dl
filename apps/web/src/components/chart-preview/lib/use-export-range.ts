"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChartExportRange } from "./export-chart-gif";
import { clamp } from "./math";

const DEFAULT_EXPORT_DURATION_MS = 8000;
export const MIN_EXPORT_DURATION_MS = 500;
export const MAX_EXPORT_DURATION_MS = 15000;

function fullRange(totalDurationMs: number): ChartExportRange {
  return { startMs: 0, endMs: Math.max(0, totalDurationMs) };
}

function createInitialRange(currentMs: number, totalDurationMs: number): ChartExportRange {
  if (totalDurationMs <= MIN_EXPORT_DURATION_MS) return fullRange(totalDurationMs);

  const startMs = clamp(currentMs, 0, totalDurationMs - MIN_EXPORT_DURATION_MS);
  const endMs = Math.min(startMs + DEFAULT_EXPORT_DURATION_MS, totalDurationMs);

  return { startMs, endMs };
}

/** Clamp a selection into the chart and into the caller's duration budget. */
export function normalizeExportRange(
  range: ChartExportRange,
  totalDurationMs: number,
  maxDurationMs: number,
): ChartExportRange {
  if (totalDurationMs <= MIN_EXPORT_DURATION_MS) return fullRange(totalDurationMs);

  const startMs = clamp(range.startMs, 0, totalDurationMs - MIN_EXPORT_DURATION_MS);
  const maxEndMs = Math.min(totalDurationMs, startMs + maxDurationMs);
  const endMs = clamp(range.endMs, startMs + MIN_EXPORT_DURATION_MS, maxEndMs);

  return { startMs, endMs };
}

/**
 * A selected section of the chart, shared by the GIF export and the A–B repeat.
 *
 * `maxDurationMs` differs between the two: a GIF has to stay small, a practice
 * loop does not. It is applied when deriving the exposed range rather than when
 * storing it, so raising or lowering the cap (toggling the loop) re-clamps the
 * existing selection immediately instead of waiting for the next drag.
 */
export function useExportRange(
  totalDurationMs: number,
  maxDurationMs: number = MAX_EXPORT_DURATION_MS,
) {
  const [rawRange, setRawRange] = useState<ChartExportRange | null>(null);

  const range = useMemo(
    () => (rawRange ? normalizeExportRange(rawRange, totalDurationMs, maxDurationMs) : null),
    [rawRange, totalDurationMs, maxDurationMs],
  );

  const start = useCallback(
    (currentMs: number) => {
      setRawRange(createInitialRange(currentMs, totalDurationMs));
    },
    [totalDurationMs],
  );

  const update = useCallback((nextRange: ChartExportRange) => {
    setRawRange(nextRange);
  }, []);

  const clear = useCallback(() => {
    setRawRange(null);
  }, []);

  return { range, start, update, clear };
}
