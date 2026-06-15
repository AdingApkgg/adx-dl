"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAvailableDifficulties,
  type ChartDifficulty,
} from "@lxns-network/maimai-chart-engine";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { ChartCanvas } from "./chart-canvas";
import { ChartControls } from "./chart-controls";
import { ChartSettings } from "./chart-settings";
import { ChartDensityTimeline } from "./chart-density-timeline";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { applyDifficulty } from "./apply-difficulty";
import { beatsToMs } from "./lib/time-conversion";
import { exportChartGif } from "./lib/export-chart-gif";
import { downloadBlob, sanitizeFilenameId } from "./lib/file-download";

export type ChartPreviewProps = {
  /** URL to the simai `maidata.txt`. */
  maidataUrl: string;
  /** URL to the song audio (`track.mp3`); slaved as the master clock. */
  audioUrl?: string;
  /** URL to the PV video (`pv.mp4`); shown as canvas background when enabled. */
  videoUrl?: string;
  /** Human-readable name used for exported filenames. */
  chartName?: string;
  /** Preferred difficulty (catalog slot 2–6 == engine ChartDifficulty). */
  defaultDifficulty?: number;
  locale?: Locale;
};

const GIF_WINDOW_MS = 6000;

type Toast = { title: string; message: string; color: string } | null;

export function ChartPreview({
  maidataUrl,
  audioUrl,
  videoUrl,
  chartName = "chart",
  defaultDifficulty,
  locale = "zh",
}: ChartPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gifExporting, setGifExporting] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [toast, setToast] = useState<Toast>(null);

  const isFullscreen = useGameStore((s) => s.isFullscreen);
  const setIsFullscreen = useGameStore((s) => s.setIsFullscreen);
  const chartData = useGameStore((s) => s.chartData);
  const totalMeasures = useGameStore((s) => s.timeline.totalMeasures);
  const beatsPerMeasure = useGameStore((s) => s.timeline.beatsPerMeasure);

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

  // Keep the store's fullscreen flag in sync with the actual Fullscreen API state
  // (covers the user pressing Esc).
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [setIsFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleExportGif = useCallback(async () => {
    const state = useGameStore.getState();
    const chart = state.chartData;
    if (!chart || gifExporting) return;

    const settings = useGameSettingsStore.getState();
    const startMs = beatsToMs(playbackTimeRef.current, chart.bpmEvents, chart.bpm);
    const totalBeats = state.timeline.totalMeasures * state.timeline.beatsPerMeasure;
    const totalMs = beatsToMs(totalBeats, chart.bpmEvents, chart.bpm);
    const endMs = Math.min(startMs + GIF_WINDOW_MS, totalMs);
    if (endMs <= startMs) return;

    setGifExporting(true);
    setGifProgress(0);
    try {
      const blob = await exportChartGif({
        chart,
        range: { startMs, endMs },
        beatsPerMeasure: state.timeline.beatsPerMeasure,
        settings,
        onProgress: setGifProgress,
        video:
          settings.showVideo && videoUrl
            ? { url: videoUrl, leadInMs: (60000 * 4) / chart.bpm, musicOffset: settings.musicOffset }
            : undefined,
      });
      downloadBlob(blob, `maimai-chart-${sanitizeFilenameId(chartName)}.gif`);
      setToast({ title: "已导出", message: "GIF 已下载", color: "green" });
      window.setTimeout(() => setToast(null), 2500);
    } catch (error) {
      console.error("GIF export failed:", error);
      setToast({ title: "导出失败", message: "GIF 生成出错", color: "red" });
      window.setTimeout(() => setToast(null), 2500);
    } finally {
      setGifExporting(false);
      setGifProgress(0);
    }
  }, [gifExporting, videoUrl, chartName]);

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
  const densityDurationMs = chartData
    ? beatsToMs(totalMeasures * beatsPerMeasure, chartData.bpmEvents, chartData.bpm)
    : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "flex flex-col gap-4 outline-none",
        isFullscreen && "h-full w-full items-center justify-center bg-black p-4",
      )}
    >
      <ChartCanvas videoUrl={videoUrl} chartName={chartName} />

      {!isFullscreen && densityDurationMs > 0 ? (
        <ChartDensityTimeline notes={densityNotes} durationMs={densityDurationMs} />
      ) : null}

      <div className={cn("w-full", isFullscreen && "max-w-2xl")}>
        <ChartControls
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          onExportGif={handleExportGif}
          gifExporting={gifExporting}
          gifProgress={gifProgress}
        />
      </div>

      {settingsOpen ? (
        <div className={cn("w-full rounded-lg border border-border/60 bg-card/40 p-4", isFullscreen && "max-w-2xl")}>
          <ChartSettings locale={locale} />
        </div>
      ) : null}

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
