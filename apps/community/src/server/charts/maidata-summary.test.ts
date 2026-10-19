import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { summarizeMaidata } from "./maidata-summary";
import { ParseLimitError, parseSimaiChart } from "@lxns-network/maimai-chart-engine/parser";
import { normalizeChartMaidata } from "../../shared/charts-maidata";

const encode = (text: string) => new TextEncoder().encode(text);
describe("private maidata summary", () => {
  test("hashes original BOM/CRLF bytes and scans complete multiline bodies", () => {
    const bytes = encode("\uFEFF&title=Title\r\n&artist=Artist\r\n&lv_4=12+\r\n&first=-0.5\r\n&inote_4=(120){4}\r\n1,2,\r\n3,4,E\r\n&inote_5=\r\n");
    const summary = summarizeMaidata(bytes);
    expect(summary.maidataMd5Base64).toBe(createHash("md5").update(bytes).digest("base64"));
    expect(summary.title).toBe("Title");
    expect(summary.difficulties).toEqual([expect.objectContaining({ difficulty: 4, level: "12+", noteCount: 4, previewSupported: true })]);
    expect(summary.warnings).toContainEqual({ code: "EMPTY_DIFFICULTY", difficulty: 5 });
  });
  test("missing metadata remains intrinsic and legacy body stays previewable", () => {
    const summary = summarizeMaidata(encode("(120){4}1,2,E"));
    expect(summary.title).toBe("");
    expect(summary.artist).toBe("");
    expect(summary.warnings).toContainEqual({ code: "LEGACY_SINGLE_DIFFICULTY", difficulty: 4 });
    expect(summary.difficulties[0].previewSupported).toBe(true);
  });
  test("client normalization previews the same pure legacy notes that the server marks supported", () => {
    const raw = "\uFEFF(120){4}1,\r\n2,E", bytes = encode(raw);
    const summary = summarizeMaidata(bytes), normalized = normalizeChartMaidata(raw);
    expect(normalized.legacy).toBe(true);
    expect(summary.difficulties[0].previewSupported).toBe(true);
    const client = parseSimaiChart(normalized.text, 4);
    expect(client.notes.map((note) => [note.position, note.timingMs])).toEqual([[1, 2000], [2, 2500]]);
    expect(client.notes.length).toBe(summary.difficulties[0].noteCount!);
    expect(summary.maidataMd5Base64).toBe(createHash("md5").update(bytes).digest("base64"));
    expect(summary.warnings).toContainEqual({ code: "LEGACY_SINGLE_DIFFICULTY", difficulty: 4 });
  });
  test("shared normalization preserves legacy metadata and every modern multiline difficulty", () => {
    const legacy = " \t&TiTle=Title\r\n &BPM=120\r\n1,\r\n2,E";
    const normalizedLegacy = normalizeChartMaidata(legacy), legacySummary = summarizeMaidata(encode(legacy));
    expect(normalizedLegacy.legacy).toBe(true);
    expect(parseSimaiChart(normalizedLegacy.text, 4).title).toBe("Title");
    expect(parseSimaiChart(normalizedLegacy.text, 4).notes.length).toBe(legacySummary.difficulties[0].noteCount!);
    const modern = "\uFEFF &TiTle=Modern\r\n &INOTE_4=(120){4}1,\r\n2,E\r\n &INOTE_5=(150){4}3,\r\n4,E";
    const normalizedModern = normalizeChartMaidata(modern), modernSummary = summarizeMaidata(encode(modern));
    expect(normalizedModern.legacy).toBe(false);
    expect(modernSummary.title).toBe("Modern");
    for (const difficulty of [4, 5] as const) expect(parseSimaiChart(normalizedModern.text, difficulty).notes.length).toBe(modernSummary.difficulties.find((item) => item.difficulty === difficulty)!.noteCount!);
  });
  test("unknown tokens and out of range notes preserve a private archive without claiming complete preview", () => {
    const summary = summarizeMaidata(encode("&inote_4=(120){4}1,9,nonsense,E"));
    expect(summary.difficulties[0].previewSupported).toBe(false);
    expect(summary.warnings.some((warning) => warning.code === "UNKNOWN_TOKEN")).toBe(true);
    expect(summary.warnings.some((warning) => warning.code === "NOTE_OUT_OF_RANGE")).toBe(true);
    expect(summarizeMaidata(encode("&inote_4=(120){4}1-4garbage[4:1],E")).difficulties[0].previewSupported).toBe(false);
    expect(summarizeMaidata(encode("&inote_4=(120){4}1-4[#1],E")).difficulties[0].previewSupported).toBe(true);
    expect(summarizeMaidata(encode("&inote_4=(120){4}1V35[4:8]-4[4:2],E")).difficulties[0].previewSupported).toBe(false);
  });
  test.each([
    ["&inote_8=(120)1,E", "CHART_DIFFICULTY_INVALID"],
    ["&title=A\n&title=B\n&inote_4=(120)1,E", "CHART_METADATA_INVALID"],
    ["&inote_4=(120)1,E\n&inote_4=(120)2,E", "CHART_DIFFICULTY_INVALID"],
    ["&inote_4=(0)1,E", "CHART_METADATA_INVALID"],
    ["&inote_4=(120){0}1,E", "CHART_METADATA_INVALID"],
    ["&inote_4=(120){4}1-4[0#4:1],E", "CHART_METADATA_INVALID"],
    ["&first=1oops\n&inote_4=(120)1,E", "CHART_METADATA_INVALID"],
    ["&inote_4=", "CHART_DIFFICULTY_INVALID"],
    ["&inote_4=(0.001){4}1,2,E", "CHART_COMPLEXITY_EXCEEDED"],
  ])("rejects bounded structural invalidity %s", (text, code) => {
    try { summarizeMaidata(encode(text)); throw new Error("expected rejection"); }
    catch (error) { expect((error as { code: string }).code).toBe(code); }
  });
  test("rejects invalid UTF-8 and caps parser diagnostic production", () => {
    expect(() => summarizeMaidata(new Uint8Array([0xff]))).toThrow();
    const summary = summarizeMaidata(encode(`&inote_4=(120){4}${"unknown,".repeat(100)}E`));
    expect(summary.warnings.length).toBeLessThanOrEqual(64);
    expect(summary.warnings.at(-1)?.code).toBe("WARNINGS_TRUNCATED");
  });
  test("engine's optional limits stop single-token allocation while legacy two-argument calls remain valid", () => {
    expect(parseSimaiChart("&inote_4=(120){4}123,E", 4).notes.length).toBe(3);
    expect(() => parseSimaiChart("&inote_4=(120){4}123,E", 4, { maxNotes: 2 })).toThrow(ParseLimitError);
    const text = `&inote_4=(120){4}${"1".repeat(100001)},E`;
    try { summarizeMaidata(encode(text)); throw new Error("expected rejection"); }
    catch (error) { expect((error as { code: string }).code).toBe("CHART_COMPLEXITY_EXCEEDED"); }
  });
  test("preserves the engine's existing simultaneous touch/hold fixture with optional diagnostics", () => {
    // Captured from packages/maimai-chart-engine/tests/chart-touch-order.test.ts; no renderer/DOM import.
    const text = "&bpm=120\nCf/B2h[4:1]/B3h[4:1]/E3h[4:1]/B6h[4:1]/B7h[4:1]/E7h[4:1]";
    const legacy = parseSimaiChart(text), diagnostics: string[] = [];
    const bounded = parseSimaiChart(text, undefined, { maxNotes: 100000, maxDurationMs: 3600000, onDiagnostic: (entry) => diagnostics.push(entry.code) });
    expect(bounded).toEqual(legacy);
    expect(diagnostics).toEqual([]);
  });
  test("diagnoses independent V timings while keeping the existing two-argument chart result", () => {
    const text = "&inote_4=(120){4}1V35[4:8]-4[4:2],E";
    const legacy = parseSimaiChart(text, 4), diagnostics: string[] = [];
    const bounded = parseSimaiChart(text, 4, { maxNotes: 100000, maxDurationMs: 3600000, onDiagnostic: (entry) => diagnostics.push(entry.code) });
    expect(bounded).toEqual(legacy);
    expect(diagnostics).toContain("UNKNOWN_TOKEN");
  });
});


test("Majdata short Holds keep the affected difficulty previewable without ignoring invalid slots", () => {
  const text = "&inote_5=(125){4},E\n&inote_6=(200){4}8bh/2bh,4bh,5bh,Ch,1h[150#2:1],E\n&inote_7=(120)9h,E";
  const summary = summarizeMaidata(encode(text));
  expect(summary.difficulties.find((row) => row.difficulty === 6)).toMatchObject({
    previewSupported: true, noteCount: 12,
  });
  expect(summary.warnings.filter((warning) => warning.difficulty === 6)).toEqual([]);
  expect(summary.difficulties.find((row) => row.difficulty === 7)?.previewSupported).toBe(false);
  expect(summary.warnings).toContainEqual(expect.objectContaining({ difficulty: 7, code: "NOTE_OUT_OF_RANGE" }));
  const chart = parseSimaiChart(normalizeChartMaidata(text).text, 6);
  const expected = summary.difficulties.find((row) => row.difficulty === 6)!;
  expect(expected.noteCount).not.toBeNull();
  expect(chart.notes.length).toBe(expected.noteCount!);
});
