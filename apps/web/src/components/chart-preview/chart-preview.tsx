"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAvailableDifficulties,
  type ChartDifficulty,
  type Note,
} from "@lxns-network/maimai-chart-engine";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ChartCanvas } from "./chart-canvas";
import { ChartControls } from "./chart-controls";
import { ChartSettings } from "./chart-settings";
import { ChartDensityTimeline } from "./chart-density-timeline";
import { ChartExportRangeOverlay } from "./chart-export-range-overlay";
import { ChartSimaiStatements } from "./chart-simai-statements";
import { ChartShortcuts } from "./chart-shortcuts";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { useLiveBeats } from "./hooks/use-live-beats";
import { applyDifficulty } from "./apply-difficulty";
import { beatsToMs, msToBeats } from "./lib/time-conversion";
import { exportChartGif, type ChartExportRange } from "./lib/export-chart-gif";
import { useExportRange } from "./lib/use-export-range";
import { formatDuration } from "./lib/format";
import { downloadBlob, sanitizeFilenameId } from "./lib/file-download";

export type ChartPreviewProps = {
  maidataUrl: string;
  audioUrl?: string;
  videoUrl?: string;
  chartName?: string;
  defaultDifficulty?: number;
  /** Difficulty slot (2–6) → level string, from the catalog. */
  levels?: Record<number, string>;
  locale?: Locale;
};

type Toast = { title: string; message: string; color: string } | null;

/** Density timeline that tracks the live playhead in an isolated subtree so the
 *  per-frame update doesn't re-render the whole player. */
function DensityWithPlayhead({
  notes,
  durationMs,
  onSeek,
  interactive,
  children,
}: {
  notes: Note[];
  durationMs: number;
  onSeek: (ms: number) => void;
  interactive: boolean;
  children?: React.ReactNode;
}) {
  const liveBeats = useLiveBeats();
  const chartData = useGameStore((s) => s.chartData);
  const playheadMs = chartData
    ? beatsToMs(liveBeats, chartData.bpmEvents, chartData.bpm)
    : 0;
  return (
    <ChartDensityTimeline
      notes={notes}
      durationMs={durationMs}
      playheadMs={playheadMs}
      onSeek={onSeek}
      interactive={interactive}
    >
      {children}
    </ChartDensityTimeline>
  );
}

export function ChartPreview({
  maidataUrl,
  audioUrl,
  videoUrl,
  chartName = "chart",
  defaultDifficulty,
  levels,
  locale = "zh",
}: ChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gifExporting, setGifExporting] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [showControls, setShowControls] = useState(true);

  const isFullscreen = useGameStore((s) => s.isFullscreen);
  const setIsFullscreen = useGameStore((s) => s.setIsFullscreen);
  const setPreciseTime = useGameStore((s) => s.setPreciseTime);
  const chartData = useGameStore((s) => s.chartData);
  const rawSimaiText = useGameStore((s) => s.rawSimaiText);
  const selectedDifficulty = useGameStore((s) => s.selectedDifficulty);
  const totalMeasures = useGameStore((s) => s.timeline.totalMeasures);
  const beatsPerMeasure = useGameStore((s) => s.timeline.beatsPerMeasure);

  const totalBeats = totalMeasures * beatsPerMeasure;
  const totalMs = chartData ? beatsToMs(totalBeats, chartData.bpmEvents, chartData.bpm) : 0;
  const exportRange = useExportRange(totalMs);
  const gifRangeMode = exportRange.range !== null;

  // Load + parse the chart on mount / when the source changes.
  useEffect(() => {
    let cancelled = false;
    const { setMusicUrl, setRawSimaiText, setAvailableDifficulties, reset } =
      useGameStore.getState();

    if (audioUrl) setMusicUrl(audioUrl);

    (async () => {
      try {
        const response = await fetch(maidataUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const simai = await response.text();
        if (cancelled) return;

        setRawSimaiText(simai);
        const available = getAvailableDifficulties(simai);
        setAvailableDifficulties(available);

        const preferred = defaultDifficulty as ChartDifficulty | undefined;
        let diff: ChartDifficulty | null = preferred && available[preferred] ? preferred : null;
        if (!diff) {
          const highest = (Object.keys(available) as unknown as string[])
            .map(Number)
            .filter((d) => available[d as ChartDifficulty])
            .sort((a, b) => b - a)[0];
          diff = (highest as ChartDifficulty) ?? null;
        }
        if (diff) applyDifficulty(diff);
      } catch (error) {
        console.error("Failed to load chart:", error);
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [maidataUrl, audioUrl, defaultDifficulty]);

  // Transient toast driven by the canvas's notify events (export/copy results).
  useEffect(() => {
    let timer: number | undefined;
    const onNotify = (e: Event) => {
      const detail = (e as CustomEvent).detail as { title: string; message: string; color: string };
      setToast(detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 2500);
    };
    window.addEventListener("astrodx-chart-notify", onNotify);
    return () => {
      window.removeEventListener("astrodx-chart-notify", onNotify);
      window.clearTimeout(timer);
    };
  }, []);

  const showToast = useCallback((t: NonNullable<Toast>) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [setIsFullscreen]);

  // Auto-hide the fullscreen control overlay: show on pointer move, fade after 3s.
  // (showControls is only read while fullscreen, so no reset is needed otherwise.)
  useEffect(() => {
    if (!isFullscreen) return;
    let timer: number | undefined;
    const reveal = () => {
      setShowControls(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShowControls(false), 3000);
    };
    reveal();
    window.addEventListener("pointermove", reveal);
    window.addEventListener("pointerdown", reveal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("pointerdown", reveal);
    };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen().catch(() => {});
    }
  }, []);

  const seekToMs = useCallback(
    (ms: number) => {
      const chart = useGameStore.getState().chartData;
      if (!chart) return;
      const beats = msToBeats(ms, chart.bpmEvents, chart.bpm);
      playbackTimeRef.current = beats;
      setPreciseTime(beats, true);
    },
    [setPreciseTime],
  );

  const toggleGifRange = useCallback(() => {
    if (gifExporting) return;
    if (exportRange.range) {
      exportRange.clear();
    } else {
      const chart = useGameStore.getState().chartData;
      const currentMs = chart ? beatsToMs(playbackTimeRef.current, chart.bpmEvents, chart.bpm) : 0;
      exportRange.start(currentMs);
    }
  }, [gifExporting, exportRange]);

  const runGifExport = useCallback(
    async (range: ChartExportRange) => {
      const state = useGameStore.getState();
      const chart = state.chartData;
      if (!chart || gifExporting) return;
      const settings = useGameSettingsStore.getState();

      setGifExporting(true);
      setGifProgress(0);
      try {
        const blob = await exportChartGif({
          chart,
          range,
          beatsPerMeasure: state.timeline.beatsPerMeasure,
          settings,
          onProgress: setGifProgress,
          video:
            settings.showVideo && videoUrl
              ? {
                  url: videoUrl,
                  leadInMs: (60000 * 4) / chart.bpm,
                  musicOffset: settings.musicOffset,
                }
              : undefined,
        });
        downloadBlob(blob, `maimai-chart-${sanitizeFilenameId(chartName)}.gif`);
        showToast({ title: "已导出", message: "GIF 已下载", color: "green" });
        exportRange.clear();
      } catch (error) {
        console.error("GIF export failed:", error);
        showToast({ title: "导出失败", message: "GIF 生成出错", color: "red" });
      } finally {
        setGifExporting(false);
        setGifProgress(0);
      }
    },
    [gifExporting, videoUrl, chartName, showToast, exportRange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const store = useGameStore.getState();
      const settings = useGameSettingsStore.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          store.togglePlayback();
          break;
        case "ArrowLeft":
          e.preventDefault();
          store.stepPosition(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          store.stepPosition(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          settings.setHiSpeed(settings.hiSpeed + 0.5);
          break;
        case "ArrowDown":
          e.preventDefault();
          settings.setHiSpeed(settings.hiSpeed - 0.5);
          break;
        case ",":
          store.stepMeasure(-1);
          break;
        case ".":
          store.stepMeasure(1);
          break;
        case "r":
        case "R":
          store.restartCurrentMeasure();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
      }
    },
    [toggleFullscreen],
  );

  const densityNotes = chartData?.notes ?? [];

  const controls = (
    <ChartControls
      settingsOpen={settingsOpen}
      onToggleSettings={() => setSettingsOpen((v) => !v)}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      onToggleGifRange={toggleGifRange}
      gifRangeMode={gifRangeMode}
      gifExporting={gifExporting}
      gifProgress={gifProgress}
      levels={levels}
    />
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "outline-none",
        isFullscreen
          ? cn(
              "relative flex h-full w-full items-center justify-center bg-black",
              !showControls && "cursor-none",
            )
          : "flex flex-col gap-4",
      )}
    >
      <ChartCanvas videoUrl={videoUrl} chartName={chartName} />

      {!isFullscreen ? (
        <>
          {totalMs > 0 ? (
            <DensityWithPlayhead
              notes={densityNotes}
              durationMs={totalMs}
              onSeek={seekToMs}
              interactive={!gifRangeMode}
            >
              {exportRange.range ? (
                <ChartExportRangeOverlay
                  range={exportRange.range}
                  totalDurationMs={totalMs}
                  onChange={exportRange.update}
                  onPreview={seekToMs}
                />
              ) : null}
            </DensityWithPlayhead>
          ) : null}

          {gifRangeMode && exportRange.range ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                GIF 区间 {formatDuration(exportRange.range.endMs - exportRange.range.startMs)}
                ,拖动时间轴上的手柄调整
              </span>
              <span className="flex-1" />
              <Button
                type="button"
                size="sm"
                onClick={() => exportRange.range && runGifExport(exportRange.range)}
                disabled={gifExporting}
              >
                {gifExporting ? `导出中 ${Math.round(gifProgress * 100)}%` : "导出 GIF"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => exportRange.clear()}
                disabled={gifExporting}
              >
                取消
              </Button>
            </div>
          ) : null}

          <div className="w-full">{controls}</div>

          {settingsOpen ? (
            <div className="w-full rounded-lg border border-border/60 bg-card/40 p-4">
              <ChartSettings locale={locale} />
            </div>
          ) : null}

          <ChartSimaiStatements simaiText={rawSimaiText} difficulty={selectedDifficulty} />
          <ChartShortcuts locale={locale} />
        </>
      ) : (
        // Fullscreen: canvas stays flex-centered; controls float as an
        // auto-hiding bottom overlay so they never squeeze the 100vmin canvas.
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-5 pt-16 transition-all duration-300",
            showControls
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-full opacity-0",
          )}
        >
          {settingsOpen ? (
            <div className="max-h-[55vh] w-full max-w-2xl overflow-auto rounded-lg border border-border/60 bg-card/90 p-4 backdrop-blur [color-scheme:dark]">
              <ChartSettings locale={locale} />
            </div>
          ) : null}
          <div className="w-full max-w-2xl">{controls}</div>
        </div>
      )}

      {toast ? (
        <div
          role="status"
          className={cn(
            "pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md px-3 py-2 text-sm text-white shadow-lg",
            toast.color === "red" ? "bg-red-600" : "bg-emerald-600",
          )}
        >
          <strong className="font-semibold">{toast.title}</strong>
          <span className="ml-2 opacity-90">{toast.message}</span>
        </div>
      ) : null}
    </div>
  );
}

export default ChartPreview;
