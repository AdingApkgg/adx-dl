import { expect, test } from "bun:test";
import { buildDensity, initialPreviewRange, normalizePreviewRange, loopPosition, gifFrameCount } from "./chart-preview-practice";

test("density counts starts once and bounds allocation on a one-hour chart", () => {
  const notes = [{ type: "tap", timingMs: 0 }, { type: "hold-start", timingMs: 500 },
    { type: "hold-end", timingMs: 1000 }, { type: "slide", timingMs: 1500 },
    { type: "touch-hold-start", timingMs: 2000 }, { type: "touch-hold-end", timingMs: 2500 },
    { type: "break", timingMs: 3600000 }, { type: "tap", timingMs: NaN }];
  const bins = buildDensity(notes, 3600, 160);
  expect(bins).toHaveLength(160);
  expect(bins.reduce((sum, bin) => sum + bin.total, 0)).toBe(5);
  expect(bins.at(-1)?.break).toBe(1);
});
test("selection stays valid at chart edges and accepts a whole short chart", () => {
  expect(initialPreviewRange(29, 30)).toEqual({ start: 29, end: 30 });
  expect(normalizePreviewRange({ start: 29.9, end: 40 }, 30)).toEqual({ start: 29.5, end: 30 });
  expect(normalizePreviewRange({ start: 9, end: 0 }, 0.2)).toEqual({ start: 0, end: 0.2 });
  expect(normalizePreviewRange({ start: NaN, end: Infinity }, 30)).toBeNull();
  expect(normalizePreviewRange({ start: 0, end: 1 }, 0)).toBeNull();
});
test("loop preserves overshoot even after a background-tab gap", () => {
  expect(loopPosition(9.75, { start: 2, end: 5 })).toBe(3.75);
  expect(loopPosition(5, { start: 2, end: 5 })).toBe(2);
  expect(loopPosition(4, { start: 2, end: 5 })).toBe(4);
});
test("GIF caps are validated before any canvas allocation", () => {
  expect(gifFrameCount({ start: 1, end: 16 }, 30)).toBe(300);
  expect(gifFrameCount({ start: 0, end: 0.2 }, 0.2)).toBe(4);
  for (const range of [{ start: 0, end: 15.1 }, { start: -1, end: 1 }, { start: 0, end: 0 }, { start: NaN, end: 1 }, { start: 0, end: 31 }]) {
    expect(() => gifFrameCount(range, 30)).toThrow();
  }
});
