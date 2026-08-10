import { describe, expect, test } from "bun:test";

import {
  MAX_EXPORT_DURATION_MS,
  MIN_EXPORT_DURATION_MS,
  normalizeExportRange,
} from "./use-export-range";

const TOTAL_MS = 120_000;

describe("normalizeExportRange", () => {
  test("leaves a legal selection untouched", () => {
    expect(normalizeExportRange({ startMs: 10_000, endMs: 18_000 }, TOTAL_MS, MAX_EXPORT_DURATION_MS)).toEqual({
      startMs: 10_000,
      endMs: 18_000,
    });
  });

  test("clamps the selection into the chart", () => {
    expect(normalizeExportRange({ startMs: -5_000, endMs: 4_000 }, TOTAL_MS, MAX_EXPORT_DURATION_MS)).toEqual({
      startMs: 0,
      endMs: 4_000,
    });
    expect(
      normalizeExportRange({ startMs: 115_000, endMs: 999_000 }, TOTAL_MS, MAX_EXPORT_DURATION_MS)
    ).toEqual({ startMs: 115_000, endMs: TOTAL_MS });
  });

  test("enforces the minimum span even when the handles cross", () => {
    expect(normalizeExportRange({ startMs: 30_000, endMs: 29_000 }, TOTAL_MS, MAX_EXPORT_DURATION_MS)).toEqual({
      startMs: 30_000,
      endMs: 30_000 + MIN_EXPORT_DURATION_MS,
    });
  });

  test("the cap is the caller's, so a loop can outlast a GIF", () => {
    const long = { startMs: 0, endMs: 90_000 };

    // GIF budget: 15 s.
    expect(normalizeExportRange(long, TOTAL_MS, MAX_EXPORT_DURATION_MS).endMs).toBe(
      MAX_EXPORT_DURATION_MS
    );
    // Practice loop: no reason to be short.
    expect(normalizeExportRange(long, TOTAL_MS, TOTAL_MS).endMs).toBe(90_000);
  });

  test("a chart shorter than the minimum span selects itself whole", () => {
    expect(normalizeExportRange({ startMs: 100, endMs: 200 }, 400, MAX_EXPORT_DURATION_MS)).toEqual({
      startMs: 0,
      endMs: 400,
    });
  });
});
