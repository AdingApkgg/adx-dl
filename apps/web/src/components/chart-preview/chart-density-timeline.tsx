"use client";

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { Note } from "@lxns-network/maimai-chart-engine";
import { cn } from "@/lib/utils";
import classes from "./chart-density-timeline.module.css";

type NoteCountKey = "tap" | "hold" | "slide" | "touch" | "break";

type NoteCountData = Record<NoteCountKey, number> & {
  startMs: number;
  total: number;
};

type ChartDensityTimelineProps = {
  notes: Note[];
  durationMs: number;
  bucketDurationMs?: number;
  barMaxHeight?: number;
  showTimeLabels?: boolean;
  showTimeMarkers?: boolean;
  /** Current playback position; draws a playhead line. */
  playheadMs?: number;
  /** Click/drag-to-seek. When provided the timeline is interactive. */
  onSeek?: (ms: number) => void;
  /** Disable seeking (e.g. while the GIF range overlay owns the pointer). */
  interactive?: boolean;
  /** Overlay rendered on top (e.g. the export-range selector). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const DEFAULT_BUCKET_DURATION_MS = 500;
const DEFAULT_BAR_MAX_HEIGHT = 32;
const TIME_MARKER_INTERVAL_MS = 30000;

const NOTE_COLORS: Record<NoteCountKey, string> = {
  tap: "#FFD700",
  hold: "#FF8C00",
  slide: "#00CED1",
  touch: "#0080FF",
  break: "#ff69b4",
};
const NOTE_COLOR_ENTRIES = Object.entries(NOTE_COLORS) as [NoteCountKey, string][];

function getLabelTransform(percent: number): string {
  if (percent === 0) return "translateX(0)";
  if (percent >= 99) return "translateX(-100%)";
  return "translateX(-50%)";
}

function formatTimeLabel(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60000);
  const seconds = Math.floor((timeMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function classifyNote(type: Note["type"]): NoteCountKey | null {
  switch (type) {
    case "break":
      return "break";
    case "tap":
    case "simultaneous":
      return "tap";
    case "hold-start":
    case "hold-start-simultaneous":
      return "hold";
    case "slide":
      return "slide";
    case "touch":
    case "touch-hold-start":
      return "touch";
    default:
      return null;
  }
}

function createEmptyBucket(startMs: number): NoteCountData {
  return { startMs, tap: 0, hold: 0, slide: 0, touch: 0, break: 0, total: 0 };
}

function calculateNoteCounts(
  notes: Note[],
  durationMs: number,
  bucketDurationMs: number,
): NoteCountData[] {
  if (durationMs <= 0) return [];

  const bucketCount = Math.floor(durationMs / bucketDurationMs) + 1;
  const buckets: NoteCountData[] = Array.from({ length: bucketCount }, (_, i) =>
    createEmptyBucket(i * bucketDurationMs),
  );

  for (const note of notes) {
    if (note.timingMs < 0 || note.timingMs > durationMs) continue;
    const bucket = buckets[Math.floor(note.timingMs / bucketDurationMs)];
    if (!bucket) continue;
    const key = classifyNote(note.type);
    if (!key) continue;
    bucket[key]++;
    bucket.total++;
  }

  return buckets;
}

function getMaxCount(buckets: NoteCountData[]): number {
  let max = 0;
  for (const bucket of buckets) max = Math.max(max, bucket.total);
  return max || 1;
}

function getTimeMarkers(durationMs: number) {
  if (durationMs <= 0) return [];
  const markers: { timeMs: number; percent: number }[] = [];
  for (let timeMs = 0; timeMs <= durationMs; timeMs += TIME_MARKER_INTERVAL_MS) {
    markers.push({ timeMs, percent: (timeMs / durationMs) * 100 });
  }
  return markers;
}

export function ChartDensityTimeline({
  notes,
  durationMs,
  bucketDurationMs = DEFAULT_BUCKET_DURATION_MS,
  barMaxHeight = DEFAULT_BAR_MAX_HEIGHT,
  showTimeLabels = true,
  showTimeMarkers = true,
  playheadMs,
  onSeek,
  interactive = true,
  children,
  className,
  style,
}: ChartDensityTimelineProps) {
  const buckets = useMemo(
    () => calculateNoteCounts(notes, durationMs, bucketDurationMs),
    [notes, durationMs, bucketDurationMs],
  );
  const maxCount = useMemo(() => getMaxCount(buckets), [buckets]);
  const timeMarkers = useMemo(() => getTimeMarkers(durationMs), [durationMs]);

  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || durationMs <= 0 || !onSeek) return;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      onSeek((x / rect.width) * durationMs);
    },
    [durationMs, onSeek],
  );

  useEffect(() => {
    if (!onSeek || !interactive) return;
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      seekFromClientX(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [onSeek, interactive, seekFromClientX]);

  if (durationMs <= 0 || buckets.length === 0) return null;

  const seekable = Boolean(onSeek) && interactive;
  const playheadPercent =
    playheadMs !== undefined ? Math.max(0, Math.min((playheadMs / durationMs) * 100, 100)) : null;

  return (
    <div
      ref={rootRef}
      className={cn(classes.timeline, seekable && classes.seekable, className)}
      style={style}
      onPointerDown={
        seekable
          ? (e) => {
              draggingRef.current = true;
              seekFromClientX(e.clientX);
            }
          : undefined
      }
    >
      {showTimeMarkers && (
        <div className={classes.timeMarkerLines}>
          {timeMarkers.map(({ timeMs, percent }) =>
            percent === 0 ? null : (
              <div
                key={`line-${timeMs}`}
                className={classes.timeMarkerLine}
                style={{ left: `${percent}%` }}
              />
            ),
          )}
        </div>
      )}

      {showTimeLabels && (
        <div className={classes.timeLabels}>
          {timeMarkers.map(({ timeMs, percent }) => (
            <div
              key={timeMs}
              className={classes.timeLabel}
              style={{ left: `${percent}%`, transform: getLabelTransform(percent) }}
            >
              {formatTimeLabel(timeMs)}
            </div>
          ))}
        </div>
      )}

      <div className={classes.graphBars}>
        {buckets.map((bucket) => {
          if (bucket.total === 0) return null;
          const heightRatio = bucket.total / maxCount;
          const height = Math.max(2, heightRatio * barMaxHeight);
          const leftPercent = (bucket.startMs / durationMs) * 100;
          const widthPercent = (bucketDurationMs / durationMs) * 100;

          return (
            <div
              key={bucket.startMs}
              className={classes.graphBar}
              style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, height: `${height}px` }}
            >
              {NOTE_COLOR_ENTRIES.map(([key, color]) => {
                const ratio = bucket[key] / bucket.total;
                if (ratio === 0) return null;
                return (
                  <div key={key} style={{ flex: ratio, width: "100%", backgroundColor: color }} />
                );
              })}
            </div>
          );
        })}
      </div>

      {playheadPercent !== null ? (
        <div className={classes.playhead} style={{ left: `${playheadPercent}%` }} />
      ) : null}

      {children}
    </div>
  );
}

export default ChartDensityTimeline;
