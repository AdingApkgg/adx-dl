import { createHash } from "node:crypto";
import { ParseLimitError, parseSimaiChart } from "@lxns-network/maimai-chart-engine/parser";
import type { ChartDiagnostic, ChartDifficulty, ChartImportSummary } from "../../shared/charts";
import { normalizeChartMaidata } from "../../shared/charts-maidata";
import { ChartImportError } from "./errors";

const MAX_MAIDATA = 1_048_576;
const MAX_NOTES = 100_000;
const MAX_DURATION_MS = 3_600_000;
function fail(code: ConstructorParameters<typeof ChartImportError>[0]): never { throw new ChartImportError(code); }
const positive = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;

/** Structural rules are stricter than the engine's intentionally tolerant public preview. */
function validateTiming(body: string): void {
  for (const match of body.matchAll(/\(([^)]*)\)|\{([^}]*)\}/g)) {
    if (!positive(match[1] ?? match[2])) fail("CHART_METADATA_INVALID");
  }
  for (const match of body.matchAll(/\[([^\]]*)\]/g)) {
    const token = match[1];
    if (!token.includes(":")) continue;
    const parts = token.split(":")[0].split("#");
    if (!parts.every(positive)) fail("CHART_METADATA_INVALID");
  }
}

/** Hashes untouched bytes; a sanitized, bounded copy is only used for parsing. */
export function summarizeMaidata(bytes: Uint8Array): ChartImportSummary {
  if (!bytes.length || bytes.length > MAX_MAIDATA) fail("CHART_ASSET_TOO_LARGE");
  const maidataMd5Base64 = createHash("md5").update(bytes).digest("base64");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return fail("CHART_INVALID_UTF8"); }
  const normalized = normalizeChartMaidata(text);
  const metadata = new Map<string, string>();
  const bodies = new Map<ChartDifficulty, { lines: string[]; firstLine: number }>();
  let active: { lines: string[]; firstLine: number } | undefined;
  const lines = normalized.text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], trimmed = line.trim();
    if (!trimmed.startsWith("&")) { active?.lines.push(line); continue; }
    const match = /^&([^=\s]+)=(.*)$/.exec(trimmed);
    if (!match) fail("CHART_METADATA_INVALID");
    const key = match[1].toLowerCase(), value = match[2].trim();
    active = undefined;
    if (metadata.has(key)) fail(key.startsWith("inote_") ? "CHART_DIFFICULTY_INVALID" : "CHART_METADATA_INVALID");
    metadata.set(key, value);
    if (key.startsWith("inote_")) {
      if (!/^inote_[1-7]$/.test(key)) fail("CHART_DIFFICULTY_INVALID");
      const difficulty = Number(key.slice(6)) as ChartDifficulty;
      active = { lines: [value], firstLine: index + 1 }; bodies.set(difficulty, active);
    }
    if (key === "bpm" && !positive(value)) fail("CHART_METADATA_INVALID");
    if (key === "first" && (!value || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 3600)) fail("CHART_METADATA_INVALID");
    if (key.startsWith("lv_") && !/^lv_[1-7]$/.test(key)) fail("CHART_DIFFICULTY_INVALID");
  }
  const warnings: ChartDiagnostic[] = [];
  const warn = (warning: ChartDiagnostic) => {
    if (warnings.length < 63 && warning.code !== "WARNINGS_TRUNCATED") warnings.push(warning);
    else if (!warnings.some((entry) => entry.code === "WARNINGS_TRUNCATED")) warnings.push({ code: "WARNINGS_TRUNCATED" });
  };
  if (normalized.legacy) warn({ code: "LEGACY_SINGLE_DIFFICULTY", difficulty: 4 });
  if (!bodies.size) fail("CHART_DIFFICULTY_INVALID");
  const difficulties: ChartImportSummary["difficulties"] = [];
  // Reconstruct only the selected body so repeated unknown keys cannot confuse the tolerant parser.
  const prefix = [...metadata].filter(([key]) => !key.startsWith("inote_")).map(([key, value]) => `&${key}=${value}`).join("\n");
  for (const [difficulty, source] of [...bodies].sort(([a], [b]) => a - b)) {
    const body = source.lines.join("\n").trim();
    if (!body) { warn({ code: "EMPTY_DIFFICULTY", difficulty }); continue; }
    validateTiming(body);
    let previewSupported = true;
    try {
      const chart = parseSimaiChart(`${prefix}\n&inote_${difficulty}=${body}`, difficulty, {
        maxNotes: MAX_NOTES, maxDurationMs: MAX_DURATION_MS,
        onDiagnostic: (diagnostic) => {
          previewSupported = false;
          warn({ code: diagnostic.code, difficulty, ...(diagnostic.line === undefined ? {} : { line: source.firstLine + diagnostic.line - 1 }) });
        },
      });
      let durationMs = 240000 / chart.bpm;
      for (const note of chart.notes) {
        let end = note.timingMs;
        if (note.type === "slide") {
          for (let i = 0; i < (note.allDurationMs?.length ?? 1); i++) end = Math.max(end, note.timingMs + (note.allDelayMs?.[i] ?? note.delayMs ?? 0) + (note.allDurationMs?.[i] ?? note.durationMs ?? 0));
        } else if ("isHoldStart" in note && note.isHoldStart && "duration" in note) end += note.duration * 60000 / note.bpm;
        durationMs = Math.max(durationMs, end);
      }
      difficulties.push({ difficulty, designer: Array.from(metadata.get(`des_${difficulty}`) ?? metadata.get("des") ?? "").slice(0,120).join(""), level: metadata.get(`lv_${difficulty}`)?.slice(0, 120) ?? null,
        noteCount: previewSupported ? chart.notes.length : null,
        durationMs: previewSupported ? Math.ceil(durationMs) : null, previewSupported });
    } catch (error) {
      if (error instanceof ParseLimitError) fail("CHART_COMPLEXITY_EXCEEDED");
      // An unrecognized notation can still be privately archived; it never becomes a partial preview.
      warn({ code: "PREVIEW_UNSUPPORTED", difficulty });
      difficulties.push({ difficulty, designer: Array.from(metadata.get(`des_${difficulty}`) ?? metadata.get("des") ?? "").slice(0,120).join(""), level: metadata.get(`lv_${difficulty}`)?.slice(0, 120) ?? null, noteCount: null, durationMs: null, previewSupported: false });
    }
  }
  if (!difficulties.length) fail("CHART_DIFFICULTY_INVALID");
  return { title: (metadata.get("title") ?? "").slice(0, 120), artist: (metadata.get("artist") ?? "").slice(0, 120),
    maidataMd5Base64, difficulties, warnings, audio: null, hasCover: false };
}
