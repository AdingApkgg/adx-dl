"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ListOrderedIcon, LocateFixedIcon } from "lucide-react";
import type { ChartDifficulty } from "@lxns-network/maimai-chart-engine";
import { cn } from "@/lib/utils";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import classes from "./chart-simai-statements.module.css";

// Matches the 1-measure lead-in offset ChartParser adds to chart.notes so the
// statement beat lands in the same coordinate space as playbackTimeRef.
const LEAD_IN_BEATS = 4;

interface SimaiChunk {
  text: string;
  beat: number;
}
interface SimaiStatement {
  beat: number;
  chunks: SimaiChunk[];
}

function parseSimaiStatements(
  simaiText: string,
  difficulty: ChartDifficulty | null,
): SimaiStatement[] {
  if (!simaiText) return [];
  const lines = simaiText.split("\n");
  const inoteHeader = difficulty ? `&inote_${difficulty}=` : null;
  const out: SimaiStatement[] = [];
  let beat = LEAD_IN_BEATS;
  let divisor = 4;
  let inInote = false;

  const processLine = (content: string) => {
    if (!content.trim()) return;
    const chunks: SimaiChunk[] = [];
    const lineStartBeat = beat;
    let buf = "";
    let bufBeat = beat;

    const flush = () => {
      const text = buf.trim();
      if (text) chunks.push({ text, beat: bufBeat });
      buf = "";
      bufBeat = beat;
    };

    let i = 0;
    while (i < content.length) {
      const c = content[i];
      if (c === ",") {
        flush();
        beat += 4 / divisor;
        bufBeat = beat;
        i++;
      } else if (c === "(") {
        const m = content.substring(i).match(/^\((\d+(?:\.\d+)?)\)(\{(\d+(?:\.\d+)?)\})?/);
        if (m) {
          if (m[3]) divisor = parseFloat(m[3]);
          buf += m[0];
          i += m[0].length;
        } else {
          buf += c;
          i++;
        }
      } else if (c === "{") {
        const m = content.substring(i).match(/^\{(\d+(?:\.\d+)?)\}/);
        if (m) {
          divisor = parseFloat(m[1]);
          buf += m[0];
          i += m[0].length;
        } else {
          buf += c;
          i++;
        }
      } else {
        buf += c;
        i++;
      }
    }
    flush();
    if (chunks.length > 0) out.push({ beat: lineStartBeat, chunks });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (inoteHeader && trimmed.toLowerCase().startsWith(inoteHeader.toLowerCase())) {
      inInote = true;
      processLine(line.substring(line.indexOf("=") + 1));
    } else if (trimmed.startsWith("&")) {
      inInote = false;
    } else if (inInote || !difficulty) {
      processLine(line);
    }
  }

  if (out.length === 0 && simaiText.trim()) {
    beat = LEAD_IN_BEATS;
    divisor = 4;
    for (const line of lines) {
      if (!line.trim().startsWith("&")) processLine(line);
    }
  }

  return out;
}

const MARKER_ONLY_RE = /^[({][^a-zA-Z0-9/]*[\d.]+[)}](\{[\d.]+\})?$/;

const StatementRow = memo(function StatementRow({
  statement,
  index,
  isActive,
  activeChunkIdx,
  isMarkerOnly,
  seekTo,
  registerRef,
}: {
  statement: SimaiStatement;
  index: number;
  isActive: boolean;
  activeChunkIdx: number;
  isMarkerOnly: boolean;
  seekTo: (beat: number) => void;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(el) => registerRef(index, el)}
      className={cn(classes.row, isActive && classes.rowActive, isMarkerOnly && classes.rowMarker)}
      onClick={() => seekTo(statement.beat)}
    >
      <span className={classes.beat}>{statement.beat.toFixed(2)}</span>
      <span className={classes.chunks}>
        {statement.chunks.map((c, ci) => (
          <span
            key={ci}
            className={cn(classes.chunk, isActive && ci === activeChunkIdx && classes.chunkActive)}
            onClick={(e) => {
              e.stopPropagation();
              seekTo(c.beat);
            }}
          >
            {c.text}
          </span>
        ))}
      </span>
    </div>
  );
});

export function ChartSimaiStatements({
  simaiText,
  difficulty,
  title = "Simai 语句",
}: {
  simaiText: string;
  difficulty: ChartDifficulty | null;
  title?: string;
}) {
  const statements = useMemo(
    () => parseSimaiStatements(simaiText, difficulty),
    [simaiText, difficulty],
  );
  const chunkLocations = useMemo(
    () =>
      statements.flatMap((statement, line) =>
        statement.chunks.map((chunk, chunkIndex) => ({ beat: chunk.beat, line, chunk: chunkIndex })),
      ),
    [statements],
  );
  const markerFlags = useMemo(
    () => statements.map((s) => s.chunks.every((c) => MARKER_ONLY_RE.test(c.text.trim()))),
    [statements],
  );
  const setPreciseTime = useGameStore((s) => s.setPreciseTime);

  const seekTo = useCallback(
    (beat: number) => {
      playbackTimeRef.current = beat;
      setPreciseTime(beat, true);
    },
    [setPreciseTime],
  );

  const [active, setActive] = useState<{ line: number; chunk: number }>({ line: -1, chunk: -1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const registerRef = useCallback((index: number, el: HTMLDivElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) {
      // Clear highlight when collapsed — intentional reset, not a render-derived value.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive({ line: -1, chunk: -1 });
      return;
    }
    let raf: number | null = null;
    let lastLine = -1;
    let lastChunk = -1;
    let lastBeat = -1;
    const findChunkLocationAt = (beat: number) => {
      let lo = 0;
      let hi = chunkLocations.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (chunkLocations[mid].beat <= beat) lo = mid + 1;
        else hi = mid;
      }
      return chunkLocations[Math.max(0, lo - 1)] ?? null;
    };
    const tick = () => {
      const state = useGameStore.getState();
      const curBeat = state.isPlaying ? playbackTimeRef.current : state.timeline.preciseTime;
      if (curBeat === lastBeat) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastBeat = curBeat;
      const location = findChunkLocationAt(curBeat);
      const lineIdx = location?.line ?? -1;
      const chunkIdx = location?.chunk ?? -1;
      if (lineIdx !== lastLine || chunkIdx !== lastChunk) {
        lastLine = lineIdx;
        lastChunk = chunkIdx;
        setActive({ line: lineIdx, chunk: chunkIdx });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [chunkLocations, expanded]);

  const [autoScroll, setAutoScroll] = useState(true);
  const pauseAutoScroll = useCallback(() => setAutoScroll(false), []);

  const centerActive = useCallback(() => {
    const el = itemRefs.current[active.line];
    const container = containerRef.current;
    if (!el || !container) return;
    const rowTop = el.offsetTop - container.offsetTop;
    const target =
      el.offsetHeight > container.clientHeight
        ? rowTop
        : rowTop - container.clientHeight / 2 + el.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [active.line]);

  useEffect(() => {
    if (autoScroll) centerActive();
  }, [autoScroll, centerActive]);

  if (statements.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <ListOrderedIcon className="size-4" aria-hidden="true" />
          {title}
        </span>
        <ChevronDownIcon
          className={cn("size-4 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div className="relative px-2 pb-2">
          <div
            ref={containerRef}
            onWheel={pauseAutoScroll}
            onTouchMove={pauseAutoScroll}
            className={classes.viewport}
          >
            {statements.map((s, i) => {
              const isActive = i === active.line;
              return (
                <StatementRow
                  key={i}
                  statement={s}
                  index={i}
                  isActive={isActive}
                  activeChunkIdx={isActive ? active.chunk : -1}
                  isMarkerOnly={markerFlags[i]}
                  seekTo={seekTo}
                  registerRef={registerRef}
                />
              );
            })}
          </div>
          {!autoScroll ? (
            <button
              type="button"
              onClick={() => setAutoScroll(true)}
              aria-label="恢复自动滚动"
              className="absolute right-3 top-1 rounded-md border border-border/60 bg-background/70 p-1 backdrop-blur"
            >
              <LocateFixedIcon className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ChartSimaiStatements;
