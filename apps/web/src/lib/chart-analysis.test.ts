import { describe, expect, test } from "bun:test";

import type { Note } from "@lxns-network/maimai-chart-engine";

import { bpmRange, chartDurationMs, countNotes, tidyBpm } from "./chart-analysis";

/**
 * These numbers end up printed on every chart page, so the invariants worth
 * pinning are: buckets never overlap, `total` is their sum, and hold tails
 * never inflate the count.
 */
function note(type: string, extra: Record<string, unknown> = {}): Note {
  return { type, timingMs: 0, ...extra } as unknown as Note;
}

describe("countNotes", () => {
  test("counts each judged object exactly once", () => {
    const counts = countNotes([
      note("tap"),
      note("simultaneous"),
      note("break"),
      note("hold-start"),
      note("hold-end"),
      note("hold-start-simultaneous"),
      note("hold-end-simultaneous"),
      note("slide"),
      note("touch"),
      note("touch-hold-start"),
      note("touch-hold-end"),
    ]);

    expect(counts).toEqual({
      tap: 2,
      hold: 2,
      slide: 1,
      touch: 1,
      touch_hold: 1,
      break: 1,
      total: 8,
    });
  });

  test("a BREAK tap is not also counted as a tap", () => {
    const counts = countNotes([note("break"), note("break"), note("tap")]);
    expect(counts.break).toBe(2);
    expect(counts.tap).toBe(1);
    expect(counts.total).toBe(3);
  });

  test("a split slide counts one judged path per segment", () => {
    const counts = countNotes([note("slide", { allSlideSegments: [[], [], []] }), note("slide")]);
    expect(counts.slide).toBe(4);
  });

  test("total always equals the sum of the buckets", () => {
    const counts = countNotes([
      note("tap"),
      note("break"),
      note("hold-start"),
      note("slide", { allSlideSegments: [[], []] }),
      note("touch"),
      note("touch-hold-start"),
    ]);
    const { total, ...buckets } = counts;
    expect(Object.values(buckets).reduce((sum, value) => sum + value, 0)).toBe(total);
  });

  test("an empty chart is all zeroes, not NaN", () => {
    expect(countNotes([]).total).toBe(0);
  });
});

describe("chartDurationMs", () => {
  test("uses the last judged moment, including a slide's travel time", () => {
    const chart = {
      notes: [
        note("tap", { timingMs: 1000 }),
        note("slide", { timingMs: 2000, delayMs: 250, durationMs: 750 }),
      ],
    };
    expect(chartDurationMs(chart)).toBe(3000);
  });

  test("a long tail earlier in the chart cannot shorten the span", () => {
    const chart = {
      notes: [
        note("slide", { timingMs: 1000, delayMs: 0, durationMs: 9000 }),
        note("tap", { timingMs: 5000 }),
      ],
    };
    expect(chartDurationMs(chart)).toBe(10_000);
  });

  test("an empty chart has no span", () => {
    expect(chartDurationMs({ notes: [] })).toBe(0);
  });
});

describe("tidyBpm", () => {
  test("snaps away authoring noise but keeps real decimals", () => {
    expect(tidyBpm(290.001)).toBe(290);
    expect(tidyBpm(179.98)).toBe(180);
    expect(tidyBpm(128.7)).toBe(128.7);
    expect(tidyBpm(38.83)).toBe(38.8);
  });
});

describe("bpmRange", () => {
  test("spans the initial BPM and every change event", () => {
    expect(
      bpmRange({
        bpm: 150,
        bpmEvents: [{ bpm: 75 }, { bpm: 225.002 }] as never,
      })
    ).toEqual({ min: 75, max: 225 });
  });

  test("a constant-tempo chart reports the same value twice", () => {
    expect(bpmRange({ bpm: 173, bpmEvents: [] as never })).toEqual({ min: 173, max: 173 });
  });

  test("ignores zero and non-finite tempos rather than reporting 0", () => {
    expect(
      bpmRange({ bpm: Number.NaN, bpmEvents: [{ bpm: 0 }, { bpm: 200 }] as never })
    ).toEqual({ min: 200, max: 200 });
  });

  test("returns null when nothing usable is present", () => {
    expect(bpmRange({ bpm: Number.NaN, bpmEvents: [] as never })).toBeNull();
  });
});
