"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChartExportRange } from "./lib/export-chart-gif";
import { MIN_EXPORT_DURATION_MS, MAX_EXPORT_DURATION_MS } from "./lib/use-export-range";
import { clamp } from "./lib/math";
import { formatDuration } from "./lib/format";
import classes from "./chart-export-range-overlay.module.css";

type DragMode = "start" | "end" | "selection";

type ExportRangeOverlayProps = {
  range: ChartExportRange;
  totalDurationMs: number;
  onChange: (range: ChartExportRange) => void;
  /** Seek the canvas to the dragged edge so the user previews that frame. */
  onPreview?: (ms: number) => void;
};

// Ported from lxns ExportRangeOverlay, minus the viewport-pan mode (our density
// timeline always shows the full chart, so there's nothing to pan).
export function ChartExportRangeOverlay({
  range,
  totalDurationMs,
  onChange,
  onPreview,
}: ExportRangeOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rootWidthRef = useRef(0);
  const draggingModeRef = useRef<DragMode | null>(null);
  const handleDragOffsetMsRef = useRef(0);
  const selectionDragOffsetMsRef = useRef(0);
  const rangeRef = useRef(range);
  const totalDurationMsRef = useRef(totalDurationMs);
  const onChangeRef = useRef(onChange);
  const onPreviewRef = useRef(onPreview);

  // Keep the latest props in refs for the imperative pointer handlers, synced
  // after each render (not during, which React's rules forbid).
  useEffect(() => {
    rangeRef.current = range;
    totalDurationMsRef.current = totalDurationMs;
    onChangeRef.current = onChange;
    onPreviewRef.current = onPreview;
  });

  const startPercent = totalDurationMs > 0 ? (range.startMs / totalDurationMs) * 100 : 0;
  const endPercent = totalDurationMs > 0 ? (range.endMs / totalDurationMs) * 100 : 0;
  const durationMs = Math.max(0, range.endMs - range.startMs);

  const updateDragging = useCallback((clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const width = rootWidthRef.current;
    const total = totalDurationMsRef.current;
    if (!rect || width <= 0 || total <= 0) return;

    const x = clamp(clientX - rect.left, 0, width);
    const pointerMs = (x / width) * total;

    const mode = draggingModeRef.current;
    if (!mode) return;

    const currentRange = rangeRef.current;
    const targetMs =
      mode === "start" || mode === "end" ? pointerMs - handleDragOffsetMsRef.current : pointerMs;
    let newRange: ChartExportRange;

    if (mode === "start") {
      newRange = {
        startMs: Math.max(
          currentRange.endMs - MAX_EXPORT_DURATION_MS,
          Math.min(targetMs, currentRange.endMs - MIN_EXPORT_DURATION_MS),
        ),
        endMs: currentRange.endMs,
      };
    } else if (mode === "selection") {
      const rangeDurationMs = currentRange.endMs - currentRange.startMs;
      const startMs = clamp(targetMs - selectionDragOffsetMsRef.current, 0, total - rangeDurationMs);
      newRange = { startMs, endMs: startMs + rangeDurationMs };
    } else {
      newRange = {
        startMs: currentRange.startMs,
        endMs: Math.min(
          currentRange.startMs + MAX_EXPORT_DURATION_MS,
          Math.max(targetMs, currentRange.startMs + MIN_EXPORT_DURATION_MS),
        ),
      };
    }

    onChangeRef.current(newRange);
    onPreviewRef.current?.(mode === "end" ? newRange.endMs : newRange.startMs);
  }, []);

  const startDragging = (mode: DragMode, clientX: number) => {
    rootWidthRef.current = rootRef.current?.getBoundingClientRect().width ?? 0;
    draggingModeRef.current = mode;

    const rect = rootRef.current?.getBoundingClientRect();
    const width = rootWidthRef.current;
    const total = totalDurationMsRef.current;

    if (mode === "selection") {
      if (rect && width > 0 && total > 0) {
        const x = clamp(clientX - rect.left, 0, width);
        selectionDragOffsetMsRef.current = (x / width) * total - rangeRef.current.startMs;
      }
    } else {
      if (rect && width > 0 && total > 0) {
        const x = clamp(clientX - rect.left, 0, width);
        const pointerMs = (x / width) * total;
        const currentRange = rangeRef.current;
        const handleMs = mode === "start" ? currentRange.startMs : currentRange.endMs;
        handleDragOffsetMsRef.current = pointerMs - handleMs;
        onPreviewRef.current?.(handleMs);
      }
      return;
    }

    updateDragging(clientX);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingModeRef.current) return;
      event.preventDefault();
      updateDragging(event.clientX);
    };
    const handlePointerUp = () => {
      draggingModeRef.current = null;
    };
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [updateDragging]);

  return (
    <div ref={rootRef} className={classes.overlay}>
      <div className={classes.shade} style={{ left: 0, width: `${startPercent}%` }} />
      <div
        className={classes.shade}
        style={{ left: `${endPercent}%`, width: `${100 - endPercent}%` }}
      />
      <div
        className={classes.selection}
        style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startDragging("selection", event.clientX);
        }}
      >
        <div className={classes.durationLabel}>{formatDuration(durationMs)}</div>
      </div>
      <div
        className={cnHandle(classes.handle, classes.startHandle)}
        style={{ left: `${startPercent}%` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startDragging("start", event.clientX);
        }}
      >
        <div className={classes.handleGrip} />
      </div>
      <div
        className={cnHandle(classes.handle, classes.endHandle)}
        style={{ left: `${endPercent}%` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startDragging("end", event.clientX);
        }}
      >
        <div className={classes.handleGrip} />
      </div>
    </div>
  );
}

function cnHandle(a: string, b: string): string {
  return `${a} ${b}`;
}

export default ChartExportRangeOverlay;
