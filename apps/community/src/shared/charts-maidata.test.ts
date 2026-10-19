import { expect, test } from "bun:test";
import { normalizeChartMaidata, normalizeChartMaidataWithMap, originalPosition } from "./charts-maidata";

test("mapped normalization preserves old output and original BOM/CRLF/header positions", () => {
  const raw = "\uFEFF  &TiTle = 😀\r\n &INOTE_4= (120){4}1,\r\n2,E";
  const mapped = normalizeChartMaidataWithMap(raw);
  expect(mapped.text).toBe(normalizeChartMaidata(raw).text);
  const index = mapped.text.indexOf("2,E");
  expect(originalPosition(raw, mapped.offsets[index])).toEqual({ line: 3, column: 1 });
  expect(originalPosition("😀1", 2)).toEqual({ line: 1, column: 2 });
});
test("legacy metadata reorder maps body back to its original lines and synthetic header is unmapped", () => {
  const raw = "(120)1,\n&title=Test\n2,E";
  const result = normalizeChartMaidataWithMap(raw);
  expect(result.legacy).toBe(true);
  expect(result.text).toBe(normalizeChartMaidata(raw).text);
  expect(result.offsets[result.text.indexOf("&inote")]).toBe(-1);
  expect(originalPosition(raw, result.offsets[result.text.indexOf("2,E")])).toEqual({ line: 3, column: 1 });
});
