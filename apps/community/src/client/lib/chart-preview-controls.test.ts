import { expect, test } from "bun:test";
import { previewAudioStart, previewPosition } from "./chart-preview-controls";

test("audio lead-in scales in wall time while the decoded-buffer offset remains media time", () => {
  expect(previewAudioStart(0, 120, 0, 2)).toEqual({ delay: 1, offset: 0 });
  expect(previewAudioStart(0, 120, 500, 0.5)).toEqual({ delay: 3, offset: 0 });
  expect(previewAudioStart(3, 120, 500, 2)).toEqual({ delay: 0, offset: 1.5 });
  expect(previewAudioStart(0, 120, -500, 1)).toEqual({ delay: 2.5, offset: 0 });
});
test("clock anchors preserve position across speed changes and clamp at the end", () => {
  const atRateChange = previewPosition(3, 4, 0.5, 30);
  expect(atRateChange).toBe(5);
  expect(previewPosition(atRateChange, 2, 2, 30)).toBe(9);
  expect(previewPosition(29, 3, 2, 30)).toBe(30);
  expect(previewPosition(3, -10, 2, 30)).toBe(3);
});
