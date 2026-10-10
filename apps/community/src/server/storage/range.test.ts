import { expect, test } from "bun:test";
import { parseRange } from "./range";
test("one closed/open/suffix range only, safe integer bounds and 416", () => {
  expect(parseRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
  expect(parseRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
  expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  expect(parseRange("bytes=0-99", 10)).toEqual({ start: 0, end: 9 });
  for (const value of [
    "bytes=10-",
    "bytes=3-2",
    "bytes=-0",
    "bytes=0-1,3-4",
    "items=1-2",
    "bytes=9007199254740992-",
    "bytes=1.5-2",
  ])
    expect(() => parseRange(value, 10)).toThrow();
});
