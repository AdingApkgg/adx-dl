import { match } from "ts-pattern";
import type {
  Chart,
  ChartMetadata,
  ChartLevels,
  ChartDesigners,
  ChartDifficulty,
  AvailableDifficulties,
  Note,
  TapNote,
  HoldStartNote,
  HoldEndNote,
  SlideNote,
  TouchNote,
  TouchHoldStartNote,
  TouchHoldEndNote,
  BpmEvent,
  DivisorEvent,
  SlideSegment,
  SlidePathType,
  ButtonPosition,
  TouchPosition,
} from "../../types";

interface ParseNotesResult {
  notes: Note[];
  firstBpm: number;
  bpmEvents: BpmEvent[];
  divisorEvents: DivisorEvent[];
}

export interface ParseDiagnostic { code: string; line?: number; sourceStart?: number }
/** UTF16 offsets in the exact parser input. beat includes the existing four-beat lead-in. */
export interface SimaiStatement { difficulty: number; bodyStart: number; bodyEnd: number; sourceStart?: number; sourceEnd?: number; line: number; beat: number }

export interface SimaiParseOptions {
  onDiagnostic?: (diagnostic: ParseDiagnostic) => void;
  onStatement?: (statement: SimaiStatement) => void;
  maxNotes?: number;
  maxDurationMs?: number;
}
export class ParseLimitError extends Error {
  constructor() { super("Chart parsing resource limit exceeded"); this.name = "ParseLimitError"; }
}
interface ParseBudget {
  maxNotes: number;
  checkDuration: (milliseconds: number) => void;
  diagnostic: (code: string, line?: number) => void;
  statement?: (start: number, end: number, line: number, beat: number) => void;
}

const INOTE_MARKERS = [
  "&inote_1=",
  "&inote_2=",
  "&inote_3=",
  "&inote_4=",
  "&inote_5=",
  "&inote_6=",
  "&inote_7=", // 本地补丁：宴 (UTAGE) — 上游只到 6，re-sync 时须重打
];

function hasChartDigit(text: string): boolean {
  for (const char of text) {
    if (char >= "1" && char <= "8") return true;
  }
  return false;
}

function splitLines(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function isMultiDigitNote(noteStr: string): boolean {
  if (noteStr.length < 2) return false;
  for (const char of noteStr) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

/**
 * 探测谱面里包含哪些可用难度。
 * 检查 `&inote_1=` 到 `&inote_6=`；如果都没写但正文里有音符按键（'1'-'8'），当单难度谱面回退并把难度 4 标为可用。
 * 不会抛错，找不到任何可用内容就返回空对象。
 */
export function getAvailableDifficulties(simaiText: string): AvailableDifficulties {
  const available: AvailableDifficulties = {};
  const lowerSimaiText = simaiText.toLowerCase();

  for (let i = 0; i < INOTE_MARKERS.length; i++) {
    if (lowerSimaiText.includes(INOTE_MARKERS[i])) {
      available[(i + 1) as ChartDifficulty] = true;
    }
  }

  if (Object.keys(available).length === 0) {
    const hasChartContent = hasChartDigit(
      splitLines(simaiText)
        .filter((line) => !line.trimStart().startsWith("&"))
        .join(""),
    );
    if (hasChartContent) {
      available[4] = true;
    }
  }

  return available;
}

/**
 * 解析 Simai 文本谱面并输出 Chart 对象。
 *
 * 未指定难度时默认挑最高可用难度，单难度谱面回退到难度 4。
 * 开头会自动垫 1 小节（4 拍）前奏偏移。
 *
 * @throws {Error} 文本为空、缺少 `&` 元数据、指定难度不存在、缺少 BPM 声明或语法解析出错时抛错。
 */
export function parseSimaiChart(simaiText: string, difficulty?: ChartDifficulty, options?: SimaiParseOptions): Chart {
  if (!simaiText || typeof simaiText !== "string") {
    throw new Error("Invalid input: expected a non-empty string");
  }

  const lines = splitLines(simaiText);

  if (!lines.some((line) => line.startsWith("&"))) {
    throw new Error("Invalid simai format: expected & metadata lines (e.g. &title=, &inote_4=)");
  }

  const metadata: ChartMetadata = {
    bpm: Number.NaN,
    title: "",
    artist: "",
    designer: "",
    level: {},
    designers: {},
    availableDifficulties: {},
    inotes: {},
  };

  const collectSource = Boolean(options?.onStatement || options?.onDiagnostic);
  const lineOffsets: number[] = [];
  if (collectSource) { let at = 0; for (const line of simaiText.split("\n")) { lineOffsets.push(at); at += line.length + 1; } }
  const bodySources: Record<number, { start: number; length: number }[]> = {};
  let currentSources: { start: number; length: number }[] = [];
  let currentInote: number | null = null;
  let currentInoteContent: string[] = [];

  try {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      const inoteMatch = trimmedLine.match(/^&inote_(\d)=(.*)$/i);
      if (inoteMatch) {
        if (currentInote !== null) {
          metadata.inotes[currentInote] = currentInoteContent.join("\n");
          if (collectSource) bodySources[currentInote] = currentSources;
          metadata.availableDifficulties[currentInote as ChartDifficulty] = true;
        }

        currentInote = parseInt(inoteMatch[1]);
        currentInoteContent = inoteMatch[2] ? [inoteMatch[2]] : [];
        currentSources = inoteMatch[2] && collectSource ? [{ start: lineOffsets[i] + line.indexOf("=") + 1, length: inoteMatch[2].length }] : [];
        continue;
      }

      if (currentInote !== null) {
        if (trimmedLine.startsWith("&") && !trimmedLine.startsWith("&inote")) {
          metadata.inotes[currentInote] = currentInoteContent.join("\n");
          if (collectSource) bodySources[currentInote] = currentSources;
          metadata.availableDifficulties[currentInote as ChartDifficulty] = true;
          currentInote = null;
          currentInoteContent = [];

          parseMetadataLine(trimmedLine, metadata);
        } else if (!trimmedLine.startsWith("&")) {
          currentInoteContent.push(line);
          if (collectSource) currentSources.push({ start: lineOffsets[i], length: line.length });
        }
        continue;
      }

      if (trimmedLine.startsWith("&")) {
        parseMetadataLine(trimmedLine, metadata);
      }
    }

    if (currentInote !== null) {
      metadata.inotes[currentInote] = currentInoteContent.join("\n");
          if (collectSource) bodySources[currentInote] = currentSources;
      metadata.availableDifficulties[currentInote as ChartDifficulty] = true;
    }

    let selectedDifficulty = difficulty;
    const availableDiffs = Object.keys(metadata.inotes)
      .map(Number)
      .sort((a, b) => b - a);

    if (!selectedDifficulty && availableDiffs.length > 0) {
      selectedDifficulty = availableDiffs[0] as ChartDifficulty;
    }

    let chartBody = "";

    if (selectedDifficulty && metadata.inotes[selectedDifficulty]) {
      chartBody = metadata.inotes[selectedDifficulty];
    } else if (availableDiffs.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "" || line.startsWith("&")) continue;
        chartBody += line;
      }
      metadata.availableDifficulties[4] = true;
      selectedDifficulty = 4;
    } else {
      throw new Error(
        `Difficulty ${difficulty} not found in chart. Available: ${availableDiffs.join(", ")}`,
      );
    }

    const designerKey = `des_${selectedDifficulty}` as keyof ChartDesigners;
    const selectedDesigner = metadata.designers[designerKey] || metadata.designer;

    const hadMetadataBpm = !Number.isNaN(metadata.bpm);
    if (Number.isNaN(metadata.bpm)) {
      const inlineBpm = chartBody.match(/\((\d+(?:\.\d+)?)\)/);
      if (inlineBpm) metadata.bpm = parseFloat(inlineBpm[1]);
    }
    // 本地补丁：连内联 BPM 都没有时回落 120 而不是抛错（上游此后仍会 throw
    // "缺少 BPM 声明"，加了这条兜底后那个分支不会再触发）。AstroDX 目录不应
    // 因个别缺元数据的谱面直接白屏。re-sync 时须重打。
    if (Number.isNaN(metadata.bpm)) {
      metadata.bpm = 120;
    }

    const spans = bodySources[selectedDifficulty ?? 4] ?? [];
    const bodyLineOffsets: number[] = []; let bodyOffset = 0;
    if (collectSource) for (const line of chartBody.split("\n")) { bodyLineOffsets.push(bodyOffset); bodyOffset += line.length + 1; }
    const spanStarts: number[] = []; let spanAt = 0;
    for (const span of spans) { spanStarts.push(spanAt); spanAt += span.length + 1; }
    const sourceOffset = (offset: number, end = false): number | undefined => {
      let low = 0, high = spanStarts.length;
      while (low < high) { const mid = (low + high) >>> 1; if (spanStarts[mid] <= offset) low = mid + 1; else high = mid; }
      const index = low - 1, span = spans[index];
      if (!span || offset > spanStarts[index] + span.length || (!end && offset === spanStarts[index] + span.length)) return undefined;
      return span.start + offset - spanStarts[index];
    };
    let diagnosticCount = 0;
    const diagnostic = (code: string, line?: number) => {
      if (!options?.onDiagnostic) return;
      if (diagnosticCount < 63) options.onDiagnostic({ code, ...(line === undefined ? {} : { line, sourceStart: sourceOffset(bodyLineOffsets[line - 1] ?? -1) }) });
      else if (diagnosticCount === 63) options.onDiagnostic({ code: "WARNINGS_TRUNCATED" });
      diagnosticCount++;
    };
    if (!hadMetadataBpm && !/^\s*\([\d.]+\)/.test(chartBody)) diagnostic("MISSING_START_BPM", 1);
    const parseResult = parseNotes(chartBody, metadata.bpm, options ? { maxNotes: options.maxNotes ?? Infinity,
      checkDuration: (milliseconds) => {
        if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > (options.maxDurationMs ?? Infinity)) throw new ParseLimitError();
      }, diagnostic, statement: options.onStatement ? (start, end, line, beat) => options.onStatement!({
        difficulty: selectedDifficulty ?? 4, bodyStart: start, bodyEnd: end, sourceStart: sourceOffset(start), sourceEnd: sourceOffset(end, true), line, beat: beat + 4,
      }) : undefined } : undefined);
    const notes = parseResult.notes;
    const bpmEvents = parseResult.bpmEvents;
    const divisorEvents = parseResult.divisorEvents;
    metadata.bpm = parseResult.firstBpm;

    if (Number.isNaN(metadata.bpm)) {
      throw new Error("Simai 文件缺少 BPM 声明（无 &bpm 元数据，谱面中也没有内联 BPM）");
    }

    let maxMeasure = 0;
    let maxTiming = 0;

    for (const note of notes) {
      if (note.measure > maxMeasure) {
        maxMeasure = note.measure;
      }

      let endTiming = note.timing;

      if ("isHoldStart" in note && note.isHoldStart && "duration" in note) {
        endTiming = note.timing + note.duration;
      }

      // Slide 可能用 ## 语法按毫秒指定延迟和时长，得按最晚结束时间换算拍数以防小节数被提早截断
      if (note.type === "slide") {
        const slideNote = note as SlideNote;
        const delays = slideNote.allDelayMs ?? [slideNote.delayMs ?? 0];
        const durations = slideNote.allDurationMs ?? [slideNote.durationMs ?? 0];
        let maxEndMs = 0;
        for (let i = 0; i < Math.max(delays.length, durations.length); i++) {
          maxEndMs = Math.max(maxEndMs, (delays[i] ?? 0) + (durations[i] ?? 0));
        }
        endTiming = note.timing + (maxEndMs * slideNote.bpm) / 60000;
      }

      if (note.type === "touch-hold-start") {
        const touchHold = note as TouchHoldStartNote;
        if (touchHold.duration !== undefined) {
          endTiming = note.timing + touchHold.duration;
        }
      }

      if (endTiming > maxTiming) {
        maxTiming = endTiming;
      }
    }

    const measuresFromTiming = Math.ceil(maxTiming / 4);
    maxMeasure = Math.max(maxMeasure, measuresFromTiming);

    const leadInMs = (60000 * 4) / parseResult.firstBpm;

    for (const note of notes) {
      note.measure += 1;
      note.timing += 4;
      note.timingMs += leadInMs;

      if ("holdStartTiming" in note && note.holdStartTiming !== undefined) {
        (note as HoldEndNote | TouchHoldEndNote).holdStartTiming += 4;
      }
    }

    for (const event of bpmEvents) {
      event.timing += 4;
    }
    bpmEvents.unshift({ timing: 0, bpm: parseResult.firstBpm });

    for (const event of divisorEvents) {
      event.timing += 4;
    }
    divisorEvents.unshift({ timing: 0, divisor: 4 });
    divisorEvents.sort((a, b) => a.timing - b.timing);

    return {
      bpm: parseResult.firstBpm,
      title: metadata.title,
      artist: metadata.artist,
      designer: selectedDesigner,
      level: metadata.level,
      designers: metadata.designers,
      difficulty: selectedDifficulty,
      availableDifficulties: metadata.availableDifficulties,
      measures: maxMeasure + 2, // 前后各留 1 小节缓冲
      notes,
      bpmEvents,
      divisorEvents,
      firstMs: metadata.firstSec !== undefined ? metadata.firstSec * 1000 : undefined,
    };
  } catch (error) {
    if (error instanceof ParseLimitError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Parse error: ${message}`);
  }
}

/** 解析单行 `&key=value` 元数据并写入 metadata。 */
function parseMetadataLine(line: string, metadata: ChartMetadata): void {
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) return;

  const key = line.substring(1, eqIndex).trim();
  const value = line.substring(eqIndex + 1).trim();

  switch (key) {
    case "title":
      metadata.title = value;
      break;
    case "artist":
      metadata.artist = value;
      break;
    case "des":
      metadata.designer = value;
      break;
    case "des_1":
    case "des_2":
    case "des_3":
    case "des_4":
    case "des_5":
    case "des_6":
    case "des_7": // 本地补丁：宴 (UTAGE)
      metadata.designers[key as keyof ChartDesigners] = value;
      break;
    case "lv_1":
    case "lv_2":
    case "lv_3":
    case "lv_4":
    case "lv_5":
    case "lv_6":
    case "lv_7": // 本地补丁：宴 (UTAGE)
      metadata.level[key as keyof ChartLevels] = value;
      break;
    case "bpm": {
      const bpmVal = parseFloat(value);
      if (!isNaN(bpmVal)) {
        metadata.bpm = bpmVal;
      }
      break;
    }
    case "first": {
      const firstVal = parseFloat(value);
      if (!isNaN(firstVal)) {
        metadata.firstSec = firstVal;
      }
      break;
    }
  }
}

/**
 * 解析谱面字符流里的所有音符以及 BPM、分频变化。
 * 时间推进全靠逗号 `,`；BPM、分频、流速等标记就地生效，不消耗拍数。
 */
function parseNotes(chartBody: string, initialBpm: number, budget?: ParseBudget): ParseNotesResult {
  const notes: Note[] = [];
  const bpmEvents: BpmEvent[] = [];
  const divisorEvents: DivisorEvent[] = [];

  let currentBpm = initialBpm;
  let firstBpm: number | null = null;
  let divisor = 4;
  let currentBeat = 0;
  let currentMs = 0;
  let currentHiSpeed = 1;

  let pos = 0;
  let line = 1;

  const skipWhitespace = () => {
    while (pos < chartBody.length && isWhitespace(chartBody[pos])) {
      if (chartBody[pos] === "\n") line++;
      pos++;
    }
  };

  while (pos < chartBody.length) {
    skipWhitespace();
    if (pos >= chartBody.length) break;

    let noteContent = "";
    const startPos = pos;
    const startLine = line;

    while (pos < chartBody.length && chartBody[pos] !== ",") {
      const char = chartBody[pos];
      if (isWhitespace(char)) {
        if (char === "\n") line++;
        pos++;
        continue;
      }
      if (char === "(") {
        const bpmMatch = chartBody.slice(pos).match(/^\((\d+(?:\.\d+)?)\)/);
        if (bpmMatch) {
          currentBpm = parseFloat(bpmMatch[1]);
          if (firstBpm === null) firstBpm = currentBpm;
          bpmEvents.push({ timing: currentBeat, bpm: currentBpm });
          pos += bpmMatch[0].length;
          continue;
        }
      }
      if (char === "{") {
        const divisorMatch = chartBody.slice(pos).match(/^\{(\d+(?:\.\d+)?)\}/);
        if (divisorMatch) {
          const newDivisor = parseFloat(divisorMatch[1]);
          if (newDivisor !== divisor) {
            divisor = newDivisor;
            divisorEvents.push({ timing: currentBeat, divisor });
          }
          pos += divisorMatch[0].length;
          continue;
        }
      }
      if (char === "<") {
        const hsMatch = chartBody.slice(pos).match(/^<HS\*([-+]?\d*\.?\d+)>/i);
        if (hsMatch) {
          currentHiSpeed = parseFloat(hsMatch[1]);
          pos += hsMatch[0].length;
          continue;
        }
      }
      noteContent += char;
      pos++;
    }

    if (pos === startPos && pos < chartBody.length && chartBody[pos] !== ",") {
      pos++;
      continue;
    }

    budget?.statement?.(startPos, pos, startLine, currentBeat);
    const beatIncrement = 4 / divisor;

    if (noteContent.trim() !== "") {
      const measure = Math.floor(currentBeat / 4);
      const positionInMeasure = Math.floor(((currentBeat % 4) / 4) * 512);

      const noteGroups: string[] = [];
      let currentGroup = "";

      for (let i = 0; i < noteContent.length; i++) {
        if (noteContent[i] === "`") {
          if (currentGroup.trim() !== "") {
            noteGroups.push(currentGroup.trim());
          }
          currentGroup = "`";
        } else if (noteContent[i] === "/") {
          if (currentGroup.trim() !== "") {
            noteGroups.push(currentGroup.trim());
          }
          currentGroup = "";
        } else {
          currentGroup += noteContent[i];
        }
      }
      if (currentGroup.trim() !== "") {
        noteGroups.push(currentGroup.trim());
      }

      const isSimultaneous = noteGroups.length > 1;

      for (const group of noteGroups) {
        let noteStr = group.trim();
        if (noteStr === "") continue;

        let hasDelayMarker = false;
        if (noteStr.startsWith("`")) {
          hasDelayMarker = true;
          noteStr = noteStr.substring(1);
        }

        const parsedNotes = parseNoteString(
          noteStr,
          currentBeat,
          currentMs,
          measure,
          positionInMeasure,
          currentBpm,
          isSimultaneous,
          hasDelayMarker,
          budget ? { ...budget, maxNotes: budget.maxNotes - notes.length } : undefined,
        );

        if (budget && !parsedNotes.length && noteStr !== "E") {
          const outOfRange = /^\d+[hbx$]*($|\[)/i.test(noteStr) || /^([ABDE]\d+|C\d+)[hbfx]*(\[.*\])?$/i.test(noteStr);
          budget.diagnostic(outOfRange ? "NOTE_OUT_OF_RANGE" : "UNKNOWN_TOKEN", startLine);
        }
        if (budget) {
          if (notes.length + parsedNotes.length > budget.maxNotes) throw new ParseLimitError();
          for (const note of parsedNotes) {
            let endMs = note.timingMs;
            if (note.type === "slide") {
              for (let i = 0; i < (note.allDurationMs?.length ?? 1); i++) endMs = Math.max(endMs, note.timingMs + (note.allDelayMs?.[i] ?? note.delayMs ?? 0) + (note.allDurationMs?.[i] ?? note.durationMs ?? 0));
              if (note.allSlideSegments?.some((segments) => segments.some((segment) => segment.endPos < 1 || segment.endPos > 8 || (segment.midPos !== undefined && (segment.midPos < 1 || segment.midPos > 8))))) budget.diagnostic("NOTE_OUT_OF_RANGE", startLine);
              if (!note.slideSegments?.length) budget.diagnostic("UNKNOWN_TOKEN", startLine);
            } else if ("isHoldStart" in note && note.isHoldStart && "duration" in note) endMs += note.duration * 60000 / note.bpm;
            budget.checkDuration(endMs + 240000 / (firstBpm ?? initialBpm));
          }
        }

        if (currentHiSpeed !== 1) {
          for (const note of parsedNotes) note.hiSpeed = currentHiSpeed;
        }
        for (const note of parsedNotes) notes.push(note);
      }
    }

    currentBeat += beatIncrement;
    currentMs += (60000 * beatIncrement) / currentBpm;
    budget?.checkDuration(currentMs + 240000 / (firstBpm ?? initialBpm));

    if (pos < chartBody.length && chartBody[pos] === ",") {
      pos++;
    }
  }

  return {
    notes,
    firstBpm: firstBpm !== null ? firstBpm : initialBpm,
    bpmEvents: bpmEvents.length > 0 ? bpmEvents : [{ timing: 0, bpm: initialBpm }],
    divisorEvents,
  };
}

/** 计算 Hold 持续拍数，支持 `[分频:拍数]` 和 `[#秒数]` 两种记号。 */
function parseHoldDuration(
  divisor: string | undefined,
  beats: string | undefined,
  seconds: string | undefined,
  bpm: number,
): number {
  if (divisor) {
    return (4 / parseFloat(divisor)) * parseFloat(beats!);
  }
  return (parseFloat(seconds!) * bpm) / 60;
}

/** 解析单个音符记号（Tap、Hold、Slide、Touch 等）；键位或感应区越界时返回空数组。 */
function parseNoteString(
  noteStr: string,
  timing: number,
  timingMs: number,
  measure: number,
  positionInMeasure: number,
  bpm: number,
  isSimultaneous: boolean,
  hasDelayMarker: boolean,
  budget?: ParseBudget,
): Note[] {
  const notes: Note[] = [];
  const delayOffset = hasDelayMarker ? 1 : 0;

  const holdMatch = noteStr.match(/^(\d+)[hbx]{1,3}\[(?:([\d.]+):([\d.]+)|#([\d.]+))\][bx]*$/i);
  if (holdMatch) {
    if (budget && budget.maxNotes < 2) throw new ParseLimitError();
    const position = parseInt(holdMatch[1]) as ButtonPosition;
    const holdDuration = parseHoldDuration(holdMatch[2], holdMatch[3], holdMatch[4], bpm);
    const lowerNoteStr = noteStr.toLowerCase();
    const isBreakHold = lowerNoteStr.includes("b");
    const isEx = lowerNoteStr.includes("x");

    if (position >= 1 && position <= 8) {
      const durationMs = (60000 * holdDuration) / bpm;

      const holdStart: HoldStartNote = {
        position,
        timing,
        timingMs: timingMs + delayOffset,
        type: isSimultaneous ? "hold-start-simultaneous" : "hold-start",
        measure,
        positionInMeasure,
        scale: 1,
        bpm,
        duration: holdDuration,
        isHoldStart: true,
        isEx,
        isBreakHold,
        hasDelayMarker,
      };
      notes.push(holdStart);

      const endTiming = timing + holdDuration;
      const endTimingMs = timingMs + durationMs + delayOffset;
      const endMeasure = Math.floor(endTiming / 4);
      const endPositionInMeasure = Math.floor(((endTiming % 4) / 4) * 512);

      const holdEnd: HoldEndNote = {
        position,
        timing: endTiming,
        timingMs: endTimingMs,
        type: isSimultaneous ? "hold-end-simultaneous" : "hold-end",
        measure: endMeasure,
        positionInMeasure: endPositionInMeasure,
        scale: 1,
        bpm,
        holdStartTiming: timing,
        isHoldEnd: true,
        isEx,
        isBreakHold,
      };
      notes.push(holdEnd);

      return notes;
    }
  }

  const slideMatch = noteStr.match(/^(\d+)([bx?!@]*[-><^vpqszVw*]+.*)$/i);
  if (slideMatch && /[-><^vpqszVw]/i.test(slideMatch[2])) {
    const startPosition = parseInt(slideMatch[1]) as ButtonPosition;
    const slideNotation = slideMatch[2];
    const pathStartIndex = slideNotation.search(/[-><^vpqszVw*]/i);
    const startModifiers =
      pathStartIndex >= 0 ? slideNotation.slice(0, pathStartIndex).toLowerCase() : "";
    // 无头 Slide 标记：'?' 为引导星淡入，'!' 为启动时直接弹出
    const headlessMarker = match(startModifiers)
      .when(
        (s) => s.includes("!"),
        () => "!" as const,
      )
      .when(
        (s) => s.includes("?"),
        () => "?" as const,
      )
      .otherwise(() => null);
    const isStartBreak = startModifiers.includes("b");
    const isHeadless = headlessMarker !== null;
    // '@' 修饰符把 Slide 头部从星星换成普通 Tap 外观
    const hasTapHead = !isHeadless && startModifiers.includes("@");
    const isEx = noteStr.toLowerCase().includes("x");

    const slideParts = slideNotation.split("*");
    if (budget && (budget.maxNotes < 1 || slideParts.length > budget.maxNotes)) throw new ParseLimitError();
    const allSlideSegments: SlideSegment[][] = [];
    const allDurations: number[] = [];
    const allDurationMs: number[] = [];
    const allDelayMs: number[] = [];
    const allCustomLengths: (number | null)[] = [];
    const allSlideBreaks: boolean[] = [];

    for (const part of slideParts) {
      const hasBreak = /[-><^vpqszVw]\d*b/i.test(part) || /\]b/i.test(part);
      allSlideBreaks.push(hasBreak);

      const hasMultipleTimings = (part.match(/\[[\d.:#+]+\]/g) || []).length > 1;

      if (hasMultipleTimings) {
        const parseResult = parseSlideSegmentsWithTiming(startPosition, part, bpm, budget?.maxNotes, budget ? () => budget.diagnostic("UNKNOWN_TOKEN") : undefined);
        allSlideSegments.push(parseResult.segments);
        allDurations.push(parseResult.totalDuration);
        allDurationMs.push(parseResult.totalDurationMs);
        allDelayMs.push(60000 / bpm);
        allCustomLengths.push(null);
      } else {
        let duration = 1;
        let customDelay: number | null = null;
        let customDurationSeconds: number | null = null;
        let customLengthSeconds: number | null = null;

        const secondsMatch = part.match(/\[([\d.]+)##([\d.]+)\]/);
        const secondsOnlyMatch = part.match(/\[#([\d.]+)\]/);
        if (secondsMatch) {
          customDelay = parseFloat(secondsMatch[1]);
          customLengthSeconds = parseFloat(secondsMatch[2]);
          duration = customLengthSeconds;
        } else if (secondsOnlyMatch) {
          customLengthSeconds = parseFloat(secondsOnlyMatch[1]);
          duration = customLengthSeconds;
        } else {
          const timingMatch = part.match(/\[(?:([\d.]+)#)?([\d.]+):([\d.]+)(?:##([\d.]+))?\]/);
          if (timingMatch) {
            if (timingMatch[1]) {
              customDelay = parseFloat(timingMatch[1]);
            }
            duration = (4 / parseFloat(timingMatch[2])) * parseFloat(timingMatch[3]);
            if (timingMatch[4]) {
              customDurationSeconds = parseFloat(timingMatch[4]);
            }
          }
        }

        let durationMsValue: number;
        let delayMsValue: number;

        if (customLengthSeconds !== null) {
          durationMsValue = customLengthSeconds * 1000;
          // '[#X]' 没显式写延迟，按默认 1 拍延迟对齐引导星与拍点
          delayMsValue = customDelay !== null ? customDelay * 1000 : 60000 / bpm;
        } else {
          durationMsValue =
            customDurationSeconds !== null
              ? customDurationSeconds * 1000
              : (60000 * duration) / bpm;
          delayMsValue = customDelay !== null ? 60000 / customDelay : 60000 / bpm;
        }

        allDurations.push(duration);
        allDurationMs.push(durationMsValue);
        allDelayMs.push(delayMsValue);
        allCustomLengths.push(customDurationSeconds);

        const pathOnly = part
          .replace(/\[(?:#[\d.]+|(?:[\d.]+#)?[\d.]+:[\d.]+(?:##[\d.]+)?|[\d.]+##[\d.]+)\]/gi, "")
          .replace(/[bx]/gi, "");

        const segments = parseSlideSegments(startPosition, pathOnly, budget?.maxNotes, budget ? () => budget.diagnostic("UNKNOWN_TOKEN") : undefined);
        allSlideSegments.push(segments);
      }
    }

    if (startPosition >= 1 && startPosition <= 8) {
      const slideNote: SlideNote = {
        position: startPosition,
        timing,
        timingMs: timingMs + delayOffset,
        type: "slide",
        measure,
        positionInMeasure,
        scale: 1,
        bpm,
        isHeadless,
        headlessMode: match(headlessMarker)
          .with("!", () => "pop" as const)
          .with("?", () => "fade" as const)
          .with(null, () => undefined)
          .exhaustive(),
        hasTapHead,
        isStartBreak,
        allSlideBreaks,
        isEx,
        duration: allDurations[0],
        durationMs: allDurationMs[0],
        delayMs: allDelayMs[0],
        slideSegments: allSlideSegments[0],
        allSlideSegments,
        allDurations,
        allDurationMs,
        allDelayMs,
        allCustomLengths,
        isSplitSlide: allSlideSegments.length > 1,
        customLength: allCustomLengths[0],
        hasDelayMarker,
      };
      notes.push(slideNote);
      return notes;
    }
  }

  if (isMultiDigitNote(noteStr)) {
    if (budget && noteStr.length > budget.maxNotes) throw new ParseLimitError();
    const digits = noteStr.split("");
    let allValid = true;

    for (const digit of digits) {
      const pos = parseInt(digit);
      if (pos < 1 || pos > 8) {
        allValid = false;
        break;
      }
    }

    if (allValid) {
      for (const digit of digits) {
        const position = parseInt(digit) as ButtonPosition;
        const tapNote: TapNote = {
          position,
          timing,
          timingMs: timingMs + delayOffset,
          type: "simultaneous",
          measure,
          positionInMeasure,
          scale: 1,
          bpm,
          hasDelayMarker,
        };
        notes.push(tapNote);
      }
      return notes;
    }
  }

  const touchMatch = noteStr.match(
    /^([ABCDE])(\d*)([hbfx]*)(?:\[(?:([\d.]+):([\d.]+)|#([\d.]+))\])?$/i,
  );
  if (touchMatch) {
    const region = touchMatch[1].toUpperCase();
    const sensorNum = touchMatch[2] ? parseInt(touchMatch[2]) : null;
    const modifiers = touchMatch[3] ? touchMatch[3].toLowerCase() : "";

    let isValidTouch = false;
    if (region === "C") {
      isValidTouch = !sensorNum || sensorNum === 1 || sensorNum === 2;
    } else if (["A", "B", "D", "E"].includes(region)) {
      isValidTouch = sensorNum !== null && sensorNum >= 1 && sensorNum <= 8;
    }

    if (isValidTouch) {
      const touchPosition = (sensorNum ? `${region}${sensorNum}` : region) as TouchPosition;
      const isHold = modifiers.includes("h");
      const hasFirework = modifiers.includes("f");

      if (isHold && (touchMatch[4] || touchMatch[6])) {
        if (budget && budget.maxNotes < 2) throw new ParseLimitError();
        const holdDuration = parseHoldDuration(touchMatch[4], touchMatch[5], touchMatch[6], bpm);
        const durationMs = (60000 * holdDuration) / bpm;

        const touchHoldStart: TouchHoldStartNote = {
          position: touchPosition,
          timing,
          timingMs: timingMs + delayOffset,
          type: "touch-hold-start",
          measure,
          positionInMeasure,
          scale: 1,
          bpm,
          duration: holdDuration,
          durationMs,
          hasFirework,
          isHoldStart: true,
          hasDelayMarker,
        };
        notes.push(touchHoldStart);

        const endTiming = timing + holdDuration;
        const endTimingMs = timingMs + durationMs + delayOffset;
        const endMeasure = Math.floor(endTiming / 4);
        const endPositionInMeasure = Math.floor(((endTiming % 4) / 4) * 512);

        const touchHoldEnd: TouchHoldEndNote = {
          position: touchPosition,
          timing: endTiming,
          timingMs: endTimingMs,
          type: "touch-hold-end",
          measure: endMeasure,
          positionInMeasure: endPositionInMeasure,
          scale: 1,
          bpm,
          holdStartTiming: timing,
          hasFirework,
          isHoldEnd: true,
        };
        notes.push(touchHoldEnd);
      } else {
        const touchNote: TouchNote = {
          position: touchPosition,
          timing,
          timingMs: timingMs + delayOffset,
          type: "touch",
          measure,
          positionInMeasure,
          scale: 1,
          bpm,
          hasFirework,
          hasDelayMarker,
        };
        notes.push(touchNote);
      }
      return notes;
    }
  }

  const tapMatch = noteStr.match(/^(\d+)([bx$]*)$/i);
  if (tapMatch) {
    const position = parseInt(tapMatch[1]);
    const modifiers = tapMatch[2].toLowerCase();
    const starCount = modifiers.split("$").length - 1;
    const isBreak = modifiers.includes("b");
    const isEx = modifiers.includes("x");
    const isStar = starCount > 0;
    const isSpinningStar = starCount >= 2;

    if (position >= 1 && position <= 8) {
      const tapNote: TapNote = {
        position: position as ButtonPosition,
        timing,
        timingMs: timingMs + delayOffset,
        type: isBreak ? "break" : isSimultaneous ? "simultaneous" : "tap",
        measure,
        positionInMeasure,
        scale: 1,
        bpm,
        isStar,
        isSpinningStar,
        isEx,
        hasDelayMarker,
      };
      notes.push(tapNote);
    }
  }

  return notes;
}

interface SlidePathParseResult {
  segments: SlideSegment[];
  segmentDurations: number[];
  segmentDurationMs: number[];
  totalDuration: number;
  totalDurationMs: number;
}

/**
 * 解析带独立时间标记的复合 Slide 路径（如 `-4[8:5]>3[384:47]`）。
 * 逐段解析类型和端点，包含标准 V 字折线判定。
 */
function parseSlideSegmentsWithTiming(
  startPosition: number,
  pathNotation: string,
  defaultBpm: number,
  maxSegments = Infinity,
  onUnsupported?: () => void,
): SlidePathParseResult {
  const segments: SlideSegment[] = [];
  const segmentDurations: number[] = [];
  const segmentDurationMs: number[] = [];
  let currentPos = startPosition;
  let i = 0;

  while (i < pathNotation.length) {
    if (segments.length >= maxSegments) throw new ParseLimitError();
    const char = pathNotation[i];
    let pathType: SlidePathType | null = null;

    if (i + 1 < pathNotation.length && pathNotation[i + 1] === char && "pq".includes(char)) {
      pathType = (char + char) as SlidePathType;
      i += 2;
    } else if ("-><^vpqszVw".includes(char)) {
      pathType = char as SlidePathType;
      i++;
    } else {
      if (!/[bx?!@]/i.test(char)) onUnsupported?.();
      i++;
      continue;
    }

    if (pathType === "V") {
      let numStr = "";
      while (i < pathNotation.length && /\d/.test(pathNotation[i])) {
        numStr += pathNotation[i];
        i++;
      }

      if (i < pathNotation.length && pathNotation[i] === "[") {
        const bracketEnd = pathNotation.indexOf("]", i);
        if (bracketEnd !== -1) {
          // Independent V timing is not implemented here. Diagnostic callers
          // must not describe the legacy one-beat fallback as a complete preview.
          onUnsupported?.();
          i = bracketEnd + 1;
        }
      }

      if (numStr.length >= 2) {
        const midPos = parseInt(numStr[0]) as ButtonPosition;
        const endPos = parseInt(numStr.substring(1)) as ButtonPosition;
        const start = currentPos;

        // 标准 V 要求拐点在起点 ±2 且终点在同侧有效跨度内；不满足则退化为两条直线段
        const leftCorner = ((start + 5) % 8) + 1;
        const rightCorner = ((start + 1) % 8) + 1;
        const d = (((endPos - start) % 8) + 8) % 8;
        const isStdV =
          (midPos === leftCorner && d >= 1 && d <= 4) ||
          (midPos === rightCorner && (8 - d) % 8 >= 1 && (8 - d) % 8 <= 4);

        if (isStdV) {
          segments.push({
            type: "V",
            startPos: start as ButtonPosition,
            endPos,
            midPos,
          });
          segmentDurations.push(1);
          segmentDurationMs.push(60000 / defaultBpm);
        } else {
          if (segments.length + 2 > maxSegments) throw new ParseLimitError();
          segments.push({ type: "-", startPos: start as ButtonPosition, endPos: midPos });
          segments.push({ type: "-", startPos: midPos, endPos });
          segmentDurations.push(0.5, 0.5);
          segmentDurationMs.push((60000 * 0.5) / defaultBpm, (60000 * 0.5) / defaultBpm);
        }

        currentPos = endPos;
      } else onUnsupported?.();
    } else {
      let numStr = "";
      while (i < pathNotation.length && /\d/.test(pathNotation[i])) {
        numStr += pathNotation[i];
        i++;
      }

      while (i < pathNotation.length && /[bx]/i.test(pathNotation[i])) {
        i++;
      }

      let segDuration = 1;
      let segDurationMs = 60000 / defaultBpm;

      if (i < pathNotation.length && pathNotation[i] === "[") {
        const bracketEnd = pathNotation.indexOf("]", i);
        if (bracketEnd !== -1) {
          const timingStr = pathNotation.substring(i + 1, bracketEnd);

          const secondsMatch = timingStr.match(/^([\d.]+)##([\d.]+)$/);
          const secondsOnlyMatch = timingStr.match(/^#([\d.]+)$/);
          if (secondsMatch) {
            segDuration = parseFloat(secondsMatch[2]);
            segDurationMs = segDuration * 1000;
          } else if (secondsOnlyMatch) {
            segDurationMs = parseFloat(secondsOnlyMatch[1]) * 1000;
            segDuration = (segDurationMs * defaultBpm) / 60000;
          } else {
            const stdMatch = timingStr.match(/^(?:([\d.]+)#)?([\d.]+):([\d.]+)(?:##([\d.]+))?$/);
            if (stdMatch) {
              segDuration = (4 / parseFloat(stdMatch[2])) * parseFloat(stdMatch[3]);
              if (stdMatch[4]) {
                segDurationMs = parseFloat(stdMatch[4]) * 1000;
              } else {
                segDurationMs = (60000 * segDuration) / defaultBpm;
              }
            } else onUnsupported?.();
          }

          i = bracketEnd + 1;

          while (i < pathNotation.length && /[bx]/i.test(pathNotation[i])) {
            i++;
          }
        }
      }

      if (numStr) {
        const endPos = parseInt(numStr) as ButtonPosition;
        segments.push({
          type: pathType,
          startPos: currentPos as ButtonPosition,
          endPos: endPos,
        });
        segmentDurations.push(segDuration);
        segmentDurationMs.push(segDurationMs);
        currentPos = endPos;
      } else onUnsupported?.();
    }
  }

  const totalDuration = segmentDurations.reduce((a, b) => a + b, 0);
  const totalDurationMs = segmentDurationMs.reduce((a, b) => a + b, 0);

  return {
    segments,
    segmentDurations,
    segmentDurationMs,
    totalDuration,
    totalDurationMs,
  };
}

/** 仅提取 Slide 分段结构（缺省用 120 BPM 占位）。 */
function parseSlideSegments(startPosition: number, pathNotation: string, maxSegments?: number, onUnsupported?: () => void): SlideSegment[] {
  return parseSlideSegmentsWithTiming(startPosition, pathNotation, 120, maxSegments, onUnsupported).segments;
}
