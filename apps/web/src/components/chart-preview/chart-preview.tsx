"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  getAvailableDifficulties,
  type ChartDifficulty,
  type Note,
} from "@lxns-network/maimai-chart-engine";
import { cn } from "@/lib/utils";
import { textFetcher } from "@/lib/swr-fetcher";
import { getDictionary, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCanvas } from "./chart-canvas";
import { ChartControls } from "./chart-controls";
import { ChartSettings } from "./chart-settings";
import { ChartDensityTimeline, type DensityLegendLabels } from "./chart-density-timeline";
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

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

/** Density timeline that tracks the live playhead in an isolated subtree so the
 *  per-frame update doesn't re-render the whole player. */
function DensityWithPlayhead({
  notes,
  durationMs,
  onSeek,
  interactive,
  legendLabels,
  children,
}: {
  notes: Note[];
  durationMs: number;
  onSeek: (ms: number) => void;
  interactive: boolean;
  legendLabels?: DensityLegendLabels;
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
      legendLabels={legendLabels}
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
  const t = getDictionary(locale).preview;
  const containerRef = useRef<HTMLDivElement>(null);
  const gifAbortRef = useRef<AbortController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gifExporting, setGifExporting] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [showControls, setShowControls] = useState(true);
  // The Fullscreen API is a silent no-op on iOS Safari (no requestFullscreen,
  // no webkit fallback on <div>), so the entry points hide there.
  const [fullscreenSupported] = useState(() => {
    if (typeof document === "undefined") return false;
    const el = document.documentElement as FullscreenElement;
    return Boolean(document.fullscreenEnabled || typeof el.webkitRequestFullscreen === "function");
  });

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

  // The raw simai text is immutable and cached by URL, so revisiting a chart (or
  // remounting the player) reuses the cache with no refetch. One shot per source
  // like the original: a missing maidata won't self-heal, so no retry/revalidate
  // storm against the (cross-origin) chart host — retries stay manual (the error
  // card's button below).
  const {
    data: simai,
    error: simaiError,
    isValidating: simaiValidating,
    mutate: retrySimai,
  } = useSWR(maidataUrl, textFetcher, {
    revalidateIfStale: false,
    shouldRetryOnError: false,
    onError: (error) => console.error("Failed to load chart:", error),
  });

  // Source lifecycle: point the player at the audio and clear the store between
  // charts. reset() runs on unmount or when the source changes.
  useEffect(() => {
    const { setMusicUrl, reset } = useGameStore.getState();
    if (audioUrl) setMusicUrl(audioUrl);
    return () => reset();
  }, [maidataUrl, audioUrl]);

  // Parse + pick a difficulty once the chart text is available (re-applies when
  // the requested difficulty changes, without refetching the cached text).
  useEffect(() => {
    if (simai === undefined) return;
    const { setRawSimaiText, setAvailableDifficulties } = useGameStore.getState();

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
  }, [simai, defaultDifficulty]);

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

  const showToast = useCallback((next: NonNullable<Toast>) => {
    setToast(next);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    const onChange = () =>
      setIsFullscreen(
        (doc.fullscreenElement ?? doc.webkitFullscreenElement) === containerRef.current,
      );
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [setIsFullscreen]);

  // Auto-hide the fullscreen control overlay: show on pointer/keyboard activity,
  // fade after 3s. (showControls is only read while fullscreen, so no reset is
  // needed otherwise.) Keydown counts as activity so keyboard users can reach the
  // controls; while hidden they are also `invisible` (out of the tab order).
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
    window.addEventListener("keydown", reveal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("pointerdown", reveal);
      window.removeEventListener("keydown", reveal);
    };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current as FullscreenElement | null;
    if (!el || !fullscreenSupported) return;
    const doc = document as FullscreenDocument;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) {
        void doc.exitFullscreen().catch(() => {});
      } else {
        void doc.webkitExitFullscreen?.();
      }
    } else if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => {});
    } else {
      void el.webkitRequestFullscreen?.();
    }
  }, [fullscreenSupported]);

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

      const abortController = new AbortController();
      gifAbortRef.current = abortController;
      setGifExporting(true);
      setGifProgress(0);
      try {
        const blob = await exportChartGif({
          chart,
          range,
          beatsPerMeasure: state.timeline.beatsPerMeasure,
          settings,
          onProgress: setGifProgress,
          signal: abortController.signal,
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
        showToast({ title: t.gifExportedTitle, message: t.gifExportedBody, color: "green" });
        exportRange.clear();
      } catch (error) {
        // User cancel: keep the selected range so the export can be retried.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("GIF export failed:", error);
          showToast({ title: t.gifFailedTitle, message: t.gifFailedBody, color: "red" });
        }
      } finally {
        gifAbortRef.current = null;
        setGifExporting(false);
        setGifProgress(0);
      }
    },
    [gifExporting, videoUrl, chartName, showToast, exportRange, t],
  );

  const cancelGif = useCallback(() => {
    if (gifExporting) {
      gifAbortRef.current?.abort();
    } else {
      exportRange.clear();
    }
  }, [gifExporting, exportRange]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const store = useGameStore.getState();
      const settings = useGameSettingsStore.getState();
      switch (e.key) {
        case " ":
          // Space on a focused control must keep activating that control; only
          // treat it as play/pause when it targets the player surface itself.
          if (target.closest("button, input, select, a, [role='slider']")) return;
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

  if (simai === undefined) {
    return simaiError ? (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center"
      >
        <p className="text-sm font-semibold text-destructive">{t.loadFailedTitle}</p>
        <p className="text-xs text-muted-foreground">{t.loadFailedBody}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void retrySimai()}
          disabled={simaiValidating}
        >
          {t.retry}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-4" role="status">
        <Skeleton className="mx-auto aspect-square w-full max-w-[600px] rounded-lg" />
        <Skeleton className="h-9 w-full" />
        <p className="sr-only">{t.loading}</p>
      </div>
    );
  }

  const densityNotes = chartData?.notes ?? [];

  const controls = (
    <ChartControls
      settingsOpen={settingsOpen}
      onToggleSettings={() => setSettingsOpen((v) => !v)}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      fullscreenSupported={fullscreenSupported}
      onToggleGifRange={toggleGifRange}
      gifRangeMode={gifRangeMode}
      gifExporting={gifExporting}
      gifProgress={gifProgress}
      levels={levels}
      t={t}
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
              // `dark` so the overlay controls resolve dark-theme tokens on the
              // hardcoded black backdrop even for light-mode users.
              "dark relative flex h-full w-full items-center justify-center bg-black",
              !showControls && "cursor-none",
            )
          : "flex flex-col gap-4",
      )}
    >
      <ChartCanvas videoUrl={videoUrl} chartName={chartName} t={t} />

      {!isFullscreen ? (
        <>
          {totalMs > 0 ? (
            <DensityWithPlayhead
              notes={densityNotes}
              durationMs={totalMs}
              onSeek={seekToMs}
              interactive={!gifRangeMode}
              legendLabels={{
                label: t.legendLabel,
                tap: t.noteTap,
                hold: t.noteHold,
                slide: t.noteSlide,
                touch: t.noteTouch,
                break: t.noteBreak,
              }}
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
                {t.gifRangeHint(formatDuration(exportRange.range.endMs - exportRange.range.startMs))}
              </span>
              <span className="flex-1" />
              <Button
                type="button"
                size="sm"
                onClick={() => exportRange.range && runGifExport(exportRange.range)}
                disabled={gifExporting}
              >
                {gifExporting ? t.exportingPercent(Math.round(gifProgress * 100)) : t.exportGif}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={cancelGif}>
                {t.cancel}
              </Button>
            </div>
          ) : null}

          <div className="w-full">{controls}</div>

          {settingsOpen ? (
            <div className="w-full rounded-lg border border-border/60 bg-card/40 p-4">
              <ChartSettings locale={locale} />
            </div>
          ) : null}

          <ChartSimaiStatements
            simaiText={rawSimaiText}
            difficulty={selectedDifficulty}
            title={t.simaiTitle}
            resumeAutoScrollLabel={t.resumeAutoScroll}
          />
          <ChartShortcuts locale={locale} hint={t.keyboardHint} />
        </>
      ) : (
        // Fullscreen: canvas stays flex-centered; controls float as an
        // auto-hiding bottom overlay so they never squeeze the 100vmin canvas.
        // While hidden they turn `invisible` (unfocusable), but keyboard focus
        // landing inside keeps them shown via focus-within.
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-5 pt-16 transition-all duration-300",
            showControls
              ? "translate-y-0 opacity-100"
              : "invisible pointer-events-none translate-y-full opacity-0 focus-within:visible focus-within:pointer-events-auto focus-within:translate-y-0 focus-within:opacity-100",
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
