import { expect, test } from "bun:test";
import { ParseLimitError, parseSimaiChart } from "./SimaiParser";

// MajdataPlay's MajSimai 2.0.6: Runtime/SimaiNoteParser.cs at 12293c3.
test.each(["1h", "8bh", "4hb", "5xh", "2hx", "3bxh", "6hbx"])(
  "Majdata zero-duration button Hold %s keeps its Hold identity and modifiers",
  (token) => {
    const diagnostics: string[] = [];
    const chart = parseSimaiChart(`&inote_6=(120){4}${token},E`, 6, {
      onDiagnostic: (entry) => diagnostics.push(entry.code),
    });
    expect(diagnostics).toEqual([]);
    expect(chart.notes).toHaveLength(2);
    const [start, end] = chart.notes;
    expect(start).toMatchObject({
      position: Number(token[0]), type: "hold-start", duration: 0,
      isBreakHold: token.includes("b"), isEx: token.includes("x"),
    });
    expect(end).toMatchObject({ type: "hold-end", timing: start.timing,
      timingMs: start.timingMs, holdStartTiming: start.timing });
  },
);

test.each(["Ch", "Chf", "Cfh", "B2h", "E7hf"])(
  "Majdata zero-duration Touch Hold %s stays a Hold rather than a Touch",
  (token) => {
    const chart = parseSimaiChart(`&inote_4=(120){4}${token},E`, 4);
    expect(chart.notes).toHaveLength(2);
    const [start, end] = chart.notes;
    expect(start).toMatchObject({ type: "touch-hold-start", duration: 0,
      durationMs: 0, hasFirework: token.includes("f") });
    expect(end).toMatchObject({ type: "touch-hold-end", timingMs: start.timingMs });
  },
);

test.each([
  ["1h[4:1]", 1], ["1bh[4:1]", 1], ["1h[4:1]bx", 1],
  ["1h[#0.75]", 1.5], ["1h[150#2:1]", 1.6],
  ["Ch[150#2:1]", 1.6], ["Ch[#0.75]", 1.5],
] as const)("Hold timing %s uses the note-local BPM without changing the chart clock", (token, beats) => {
  const diagnostics: string[] = [];
  const chart = parseSimaiChart(`&inote_4=(120){4}${token},2,E`, 4, {
    onDiagnostic: (entry) => diagnostics.push(entry.code),
  });
  expect(diagnostics).toEqual([]);
  const start = chart.notes.find((note) => "isHoldStart" in note && note.isHoldStart)!;
  const end = chart.notes.find((note) => "isHoldEnd" in note && note.isHoldEnd)!;
  expect(start).toHaveProperty("duration", beats);
  expect(end.timingMs - start.timingMs).toBeCloseTo(beats * 500);
  expect(chart.notes.find((note) => note.position === 2)?.timingMs).toBe(2500);
  expect(chart.bpm).toBe(120);
});

test("zero-duration Holds preserve simultaneous and delayed notes and allocation limits", () => {
  const chart = parseSimaiChart("&inote_4=(120){4}8bh/2bh,`5bh,E", 4);
  expect(chart.notes.filter((note) => "isHoldStart" in note && note.isHoldStart)).toMatchObject([
    { type: "hold-start-simultaneous", position: 8, timingMs: 2000 },
    { type: "hold-start-simultaneous", position: 2, timingMs: 2000 },
    { position: 5, timingMs: 2501, hasDelayMarker: true },
  ]);
  for (const token of ["1h", "Ch"]) {
    expect(() => parseSimaiChart(`&inote_4=(120)${token},E`, 4, { maxNotes: 1 })).toThrow(ParseLimitError);
  }
});

test.each(["0h", "9bh", "B9h", "E0h"])("out-of-range Hold %s is still diagnosed", (token) => {
  const warnings: string[] = [];
  parseSimaiChart(`&inote_4=(120)${token},E`, 4, { onDiagnostic: (d) => warnings.push(d.code) });
  expect(warnings).toContain("NOTE_OUT_OF_RANGE");
});

test.each(["1h[bad]", "1b[4:1]", "1hgarbage"])("malformed Hold %s is unsupported, not a false position error", (token) => {
  const warnings: string[] = [];
  const chart = parseSimaiChart(`&inote_4=(120)${token},E`, 4, { onDiagnostic: (d) => warnings.push(d.code) });
  expect(chart.notes).toEqual([]);
  expect(warnings).toEqual(["UNKNOWN_TOKEN"]);
});


test("note-local BPM Hold durations remain subject to the shared duration budget", () => {
  for (const token of ["1h[1#4:1]", "Ch[1#4:1]"]) {
    expect(() => parseSimaiChart(`&inote_4=(120)${token},E`, 4, {
      maxNotes: 100000, maxDurationMs: 10000,
    })).toThrow(ParseLimitError);
  }
});
