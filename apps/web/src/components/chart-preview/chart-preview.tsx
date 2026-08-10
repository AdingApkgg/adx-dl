"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockIcon, LockOpenIcon, RepeatIcon } from "lucide-react";
import useSWR from "swr";
import {
  getAvailableDifficulties,
  type ChartDifficulty,
  type Note,
} from "@lxns-network/maimai-chart-engine";
import { cn } from "@/lib/utils";
import { textFetcher } from "@/lib/swr-fetcher";
import { AnimatePresence, EASE_OUT, motion, springSoft } from "@/components/motion";
import { getDictionary, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCanvas } from "./chart-canvas";
import { ChartControls, ChartDifficultyPicker } from "./chart-controls";
import { ChartSettingsGroups } from "./chart-settings";
import { ChartSpeedCard } from "./chart-speed-card";
import { ChartDensityTimeline, type DensityLegendLabels } from "./chart-density-timeline";
import { ChartExportRangeOverlay } from "./chart-export-range-overlay";
import { ChartSimaiStatements } from "./chart-simai-statements";
import { ChartShortcuts } from "./chart-shortcuts";
import { useDownloadsStore } from "@/components/site/downloads/downloads-store";
import { resolveDownloadUrl } from "@/lib/download-sources";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { useLiveBeats } from "./hooks/use-live-beats";
import { applyDifficulty } from "./apply-difficulty";
import { beatsToMs, msToBeats } from "./lib/time-conversion";
import { exportChartGif, type ChartExportRange } from "./lib/export-chart-gif";
import { playbackLoopRef } from "./lib/playback-loop";
import { MAX_EXPORT_DURATION_MS, useExportRange } from "./lib/use-export-range";
import { formatDuration } from "./lib/format";
import { downloadBlob, sanitizeFilenameId } from "./lib/file-download";

export type ChartPreviewProps = {
  maidataUrl: string;
  audioUrl?: string;
  videoUrl?: string;
  coverUrl?: string;
  chartName?: string;
  defaultDifficulty?: number;
  /** Difficulty slot (2–6) → level string, from the catalog. */
  levels?: Record<number, string>;
  locale?: Locale;
};

type Toast = { title: string; message: string; color: string } | null;

// Height-collapse tween shared by the settings panels and the GIF action bar —
// a springSoft-ish ease so it matches the icon springs without overshoot
// (springs on `height: auto` can bounce past the content box).
const collapseTransition = { duration: 0.35, ease: EASE_OUT };

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
  videoUrl: rawVideoUrl,
  coverUrl,
  chartName = "chart",
  defaultDifficulty,
  levels,
  locale = "zh",
}: ChartPreviewProps) {
  const t = getDictionary(locale).preview;
  const containerRef = useRef<HTMLDivElement>(null);

  // The PV can be served from any chart-media mirror (视频设置 → 视频线路);
  // the catalog URL points at the default source and is rerouted here.
  const videoSourceId = useGameSettingsStore((s) => s.videoSourceId);
  const customVideoSources = useDownloadsStore((s) => s.customSources);
  const videoUrl = useMemo(() => {
    if (!rawVideoUrl) {
      return rawVideoUrl;
    }
    const custom = customVideoSources.find((c) => c.id === videoSourceId);
    return resolveDownloadUrl(rawVideoUrl, videoSourceId, custom?.baseUrl);
  }, [rawVideoUrl, videoSourceId, customVideoSources]);
  const gifAbortRef = useRef<AbortController | null>(null);
  const [gifExporting, setGifExporting] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [showControls, setShowControls] = useState(true);
  // ?beat= deep link (written by the copy-time-URL button): read once on
  // mount, applied as soon as a chart is parsed.
  const [initialBeat] = useState<number | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = new URLSearchParams(window.location.search).get("beat");
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  });
  const initialBeatAppliedRef = useRef(false);
  // Fullscreen UI lock: playing along means tapping the screen constantly, and
  // every tap used to wake the control overlay (or hit a button). While locked
  // only the floating unlock button responds; it fades out on its own.
  const [uiLocked, setUiLocked] = useState(false);
  const [lockHintVisible, setLockHintVisible] = useState(false);
  // Portal target for the export menu and tooltips: the preview root itself.
  // A body portal is unusable here BOTH ways — the hosting overlay dialog is
  // an opaque z-[60] layer (body-level z-50 poppers render invisibly behind
  // it), and in fullscreen anything outside the fullscreened element is not
  // painted at all. Captured via callback ref so it exists from first paint.
  const [menuContainer, setMenuContainer] = useState<HTMLElement | null>(null);
  const assignContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setMenuContainer(el);
  }, []);
  // The Fullscreen API is a silent no-op on iOS Safari (no requestFullscreen,
  // no webkit fallback on <div>). The fullscreen LAYOUT, however, is pure CSS —
  // so instead of hiding the button there we fall back to pinning the player
  // over the page ourselves.
  const [nativeFullscreenSupported] = useState(() => {
    if (typeof document === "undefined") return false;
    const el = document.documentElement as FullscreenElement;
    return Boolean(document.fullscreenEnabled || typeof el.webkitRequestFullscreen === "function");
  });
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  // Speed lives in the sidebar, which fullscreen hides — practicing a passage
  // slowed down otherwise meant leaving fullscreen for every adjustment.
  const [speedPanelOpen, setSpeedPanelOpen] = useState(false);

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
  // One selection, two consumers. A GIF has to stay short; an A–B practice loop
  // has no such reason, so turning the loop on lifts the cap to the whole chart
  // (and turning it off re-clamps the selection — see useExportRange).
  const [loopEnabled, setLoopEnabled] = useState(false);
  const exportRange = useExportRange(
    totalMs,
    loopEnabled ? Math.max(totalMs, MAX_EXPORT_DURATION_MS) : MAX_EXPORT_DURATION_MS,
  );
  const rangeMode = exportRange.range !== null;
  const selectedRangeMs = exportRange.range
    ? exportRange.range.endMs - exportRange.range.startMs
    : 0;
  const gifRangeTooLong = selectedRangeMs > MAX_EXPORT_DURATION_MS;

  // Publish the loop to the render loop's module-level ref (a store field would
  // re-render the whole player on every toggle) and always retract it on unmount
  // — a stale loop would hijack the next chart mounted into the same page.
  const loopRange = loopEnabled ? exportRange.range : null;
  useEffect(() => {
    playbackLoopRef.current = loopRange;
    return () => {
      playbackLoopRef.current = null;
    };
  }, [loopRange]);

  // Apply the ?beat= deep link once the first chart parse lands.
  useEffect(() => {
    if (initialBeat === null || initialBeatAppliedRef.current || !chartData) {
      return;
    }
    initialBeatAppliedRef.current = true;
    setPreciseTime(Math.min(initialBeat, totalBeats), true);
  }, [chartData, initialBeat, setPreciseTime, totalBeats]);

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
    const onChange = () => {
      const fullscreen =
        (doc.fullscreenElement ?? doc.webkitFullscreenElement) === containerRef.current;
      setIsFullscreen(fullscreen);
      // Entering via the ⛶ button leaves focus on that button, which sits
      // inside the auto-hiding overlay — its focus-within escape would then
      // pin the overlay visible forever. Moving focus to the container also
      // arms the keyboard shortcuts immediately.
      if (fullscreen) {
        containerRef.current?.focus({ preventScroll: true });
      }
      // Leaving fullscreen (Esc / browser chrome) must never strand a locked
      // inline layout, where the lock button is not rendered.
      if (!fullscreen) {
        setUiLocked(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [setIsFullscreen]);

  // Pseudo fullscreen has no browser-level scroll lock behind it, so the page
  // underneath would still scroll (and rubber-band on iOS) under the player.
  useEffect(() => {
    if (!pseudoFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pseudoFullscreen]);

  // Auto-hide the fullscreen control overlay: show on pointer/keyboard activity,
  // fade after 3s. (showControls is only read while fullscreen, so no reset is
  // needed otherwise.) Keydown counts as activity so keyboard users can reach the
  // controls; while hidden they are also `invisible` (out of the tab order).
  useEffect(() => {
    if (!isFullscreen || uiLocked) return;
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
  }, [isFullscreen, uiLocked]);

  // Locked mode: taps only surface the floating unlock button (2.5s), never the
  // control overlay. pointermove is deliberately not a trigger — resting a palm
  // on a tablet mid-play must not keep the button lit.
  useEffect(() => {
    if (!isFullscreen || !uiLocked) return;
    let timer: number | undefined;
    const reveal = () => {
      setLockHintVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLockHintVisible(false), 2500);
    };
    reveal();
    window.addEventListener("pointerdown", reveal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reveal);
      setLockHintVisible(false);
    };
  }, [isFullscreen, uiLocked]);

  const toggleFullscreen = useCallback(() => {
    // No Fullscreen API: drive the same `isFullscreen` layout ourselves. The
    // store flag is what every consumer (canvas sizing, control overlay,
    // renderer resize) already keys off, so nothing else changes.
    if (!nativeFullscreenSupported) {
      const next = !useGameStore.getState().isFullscreen;
      setPseudoFullscreen(next);
      setIsFullscreen(next);
      if (next) {
        containerRef.current?.focus({ preventScroll: true });
      } else {
        setUiLocked(false);
      }
      return;
    }
    const el = containerRef.current as FullscreenElement | null;
    if (!el) return;
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
  }, [nativeFullscreenSupported, setIsFullscreen]);

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

  const startRangeAtPlayhead = useCallback(() => {
    const chart = useGameStore.getState().chartData;
    const currentMs = chart ? beatsToMs(playbackTimeRef.current, chart.bpmEvents, chart.bpm) : 0;
    exportRange.start(currentMs);
  }, [exportRange]);

  const toggleRangeMode = useCallback(() => {
    if (gifExporting) return;
    if (exportRange.range) {
      exportRange.clear();
      setLoopEnabled(false);
    } else {
      startRangeAtPlayhead();
    }
  }, [gifExporting, exportRange, startRangeAtPlayhead]);

  // The loop button doubles as the range's discoverable entry point: with no
  // section selected yet it opens one at the playhead instead of doing nothing.
  const toggleLoop = useCallback(() => {
    if (loopEnabled) {
      setLoopEnabled(false);
      return;
    }
    if (!exportRange.range) {
      startRangeAtPlayhead();
    }
    setLoopEnabled(true);
  }, [loopEnabled, exportRange.range, startRangeAtPlayhead]);

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
          hudLabels: { combo: t.hudCombo, breakNoEx: t.hudBreakNoEx },
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
        // The selection goes away with the export, so the loop that shared it
        // has to stand down too — otherwise the button stays lit over nothing.
        exportRange.clear();
        setLoopEnabled(false);
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
      setLoopEnabled(false);
    }
  }, [gifExporting, exportRange]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Locked = every shortcut is an accidental input (Esc still exits
      // fullscreen at the browser level and the exit auto-unlocks).
      if (uiLocked) return;
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
          // Shift steps a whole measure (upstream parity); plain arrows step
          // one position.
          if (e.shiftKey) {
            store.stepMeasure(-1);
          } else {
            store.stepPosition(-1);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            store.stepMeasure(1);
          } else {
            store.stepPosition(1);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          settings.setHiSpeed(settings.hiSpeed + 0.25);
          break;
        case "ArrowDown":
          e.preventDefault();
          settings.setHiSpeed(settings.hiSpeed - 0.25);
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
    [toggleFullscreen, uiLocked],
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
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      onToggleRangeMode={toggleRangeMode}
      rangeMode={rangeMode}
      loopEnabled={loopEnabled}
      onToggleLoop={toggleLoop}
      speedPanelOpen={speedPanelOpen}
      onToggleSpeedPanel={() => setSpeedPanelOpen((open) => !open)}
      gifExporting={gifExporting}
      gifProgress={gifProgress}
      levels={levels}
      menuContainer={menuContainer}
      t={t}
    />
  );

  // Seekable density timeline + the range action bar. Shared by both layouts —
  // the reference shows the timeline in fullscreen too, which is also what
  // makes the GIF flow usable there. The action bar shares this zero-gap
  // group so its height collapse doesn't leave a dangling parent `gap`.
  const timelineBlock =
    totalMs > 0 ? (
      <div
        className={cn(
          "flex w-full flex-col",
          !isFullscreen && "lg:[grid-area:timeline]",
        )}
      >
        <DensityWithPlayhead
          notes={densityNotes}
          durationMs={totalMs}
          onSeek={seekToMs}
          interactive={!rangeMode}
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
              maxDurationMs={
                loopEnabled ? Math.max(totalMs, MAX_EXPORT_DURATION_MS) : MAX_EXPORT_DURATION_MS
              }
              onChange={exportRange.update}
              onPreview={seekToMs}
            />
          ) : null}
        </DensityWithPlayhead>

        <AnimatePresence initial={false}>
          {rangeMode && exportRange.range ? (
            <motion.div
              key="range-actions"
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={collapseTransition}
            >
              <div className="flex flex-wrap items-center gap-2 pt-3 text-sm">
                <span className="text-muted-foreground">
                  {loopEnabled
                    ? t.loopActiveHint(formatDuration(selectedRangeMs))
                    : t.gifRangeHint(formatDuration(selectedRangeMs))}
                </span>
                <span className="flex-1" />
                <Button
                  type="button"
                  size="sm"
                  variant={loopEnabled ? "default" : "outline"}
                  aria-pressed={loopEnabled}
                  onClick={toggleLoop}
                >
                  <RepeatIcon data-icon="inline-start" aria-hidden="true" />
                  {loopEnabled ? t.loopRangeOff : t.loopRange}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="relative overflow-hidden"
                  onClick={() => exportRange.range && runGifExport(exportRange.range)}
                  // A loop may legitimately span minutes; a GIF that long would
                  // be hundreds of megabytes, so the export waits for a shorter
                  // selection rather than silently truncating it.
                  disabled={gifExporting || gifRangeTooLong}
                  title={
                    gifRangeTooLong
                      ? t.gifRangeTooLong(formatDuration(MAX_EXPORT_DURATION_MS))
                      : undefined
                  }
                >
                  {gifExporting ? (
                    // Progress fill behind the label — scaleX (not width)
                    // so it stays a pure transform.
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 origin-left bg-primary-foreground/25"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: gifProgress }}
                      transition={{ duration: 0.25, ease: EASE_OUT }}
                    />
                  ) : null}
                  <span className="relative">
                    {gifExporting
                      ? t.exportingPercent(Math.round(gifProgress * 100))
                      : t.exportGif}
                  </span>
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={cancelGif}>
                  {t.cancel}
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    ) : null;

  return (
    <div
      ref={assignContainer}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "outline-none",
        isFullscreen
          ? cn(
              // `dark` so the overlay controls resolve dark-theme tokens on the
              // hardcoded black backdrop even for light-mode users. The
              // explicit text-foreground matters: inherited `color` carries
              // body's computed (light-theme, near-black) value straight past
              // the variable flip, turning every icon invisible on black.
              "dark relative flex h-full w-full items-center justify-center bg-black text-foreground",
              // Without the Fullscreen API nothing pins the element for us, so
              // the root does it: dvh/dvw, above the host dialog's z-[60].
              pseudoFullscreen && "fixed inset-0 z-[70] h-dvh w-dvw",
              // While locked the cursor stays visible — hiding it on top of a
              // non-responsive surface reads as a hang.
              !showControls && !uiLocked && "cursor-none",
            )
          : // Desktop (lxns-style) splits into playfield column + sidebar via
            // named grid areas; the trailing 1fr row absorbs a sidebar taller
            // than the playfield so it never stretches gaps into the left rows.
            "flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start lg:gap-x-6 lg:[grid-template-areas:'canvas_side'_'timeline_side'_'controls_side'_'spacer_side']",
      )}
    >
      {/* `contents` keeps this wrapper out of the fullscreen flex layout; it
          only exists so the (never remounted) canvas can be grid-placed.
          The canvas used to be `pointer-events: none`, so tapping the chart —
          the obvious thing to do — did nothing. The handler sits on this
          wrapper, not on the canvas, because this is the level that knows the
          fullscreen state: in fullscreen a tap already means "wake the
          auto-hidden controls", and stacking play/pause on the same tap would
          pause the chart every time you went looking for a button. Keyboard
          users get the same action from Space (see onKeyDown). */}
      <div
        className={cn(isFullscreen ? "contents" : "w-full lg:[grid-area:canvas]")}
        onClick={() => {
          if (isFullscreen || uiLocked) return;
          useGameStore.getState().togglePlayback();
        }}
      >
        <ChartCanvas
          pseudoFullscreen={pseudoFullscreen}
          videoUrl={videoUrl}
          coverUrl={coverUrl}
          chartName={chartName}
          t={t}
        />
      </div>

      {!isFullscreen ? (
        <>
          {timelineBlock}

          {/* Desktop: the control block matches the canvas width and centers
              under it, echoing the reference layout. */}
          <div className="w-full lg:[grid-area:controls] lg:max-w-[600px] lg:justify-self-center">
            {controls}
          </div>

          {/* Sidebar column on desktop, ordered like the reference: simai,
              speed, difficulty, the three settings groups, shortcuts.
              `contents` on stacked layouts keeps the children flowing in the
              same order inline instead. */}
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4 lg:[grid-area:side]">
            <ChartSimaiStatements
              simaiText={rawSimaiText}
              difficulty={selectedDifficulty}
              title={t.simaiTitle}
              resumeAutoScrollLabel={t.resumeAutoScroll}
            />

            <ChartSpeedCard locale={locale} />

            <ChartDifficultyPicker
              levels={levels}
              className="hidden lg:flex"
              pillLayoutId="preview-difficulty-pill-side"
            />

            <ChartSettingsGroups locale={locale} />

            <ChartShortcuts locale={locale} hint={t.keyboardHint} />
          </div>
        </>
      ) : (
        // Fullscreen: canvas stays flex-centered; controls float as an
        // auto-hiding bottom overlay so they never squeeze the 100vmin canvas.
        // While hidden they turn `invisible` (unfocusable), but keyboard focus
        // landing inside keeps them shown via focus-within.
        <>
        <button
          type="button"
          onClick={() => {
            if (uiLocked) {
              setUiLocked(false);
            } else {
              setUiLocked(true);
              setShowControls(false);
            }
          }}
          aria-pressed={uiLocked}
          aria-label={uiLocked ? t.unlockUi : t.lockUi}
          title={uiLocked ? t.unlockUi : t.lockUi}
          className={cn(
            "fixed left-3 top-1/2 z-20 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur transition-opacity duration-300",
            (uiLocked ? lockHintVisible : showControls)
              ? "opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          {uiLocked ? (
            <LockIcon className="size-5" aria-hidden="true" />
          ) : (
            <LockOpenIcon className="size-5" aria-hidden="true" />
          )}
        </button>
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-5 pt-16 transition-all duration-300",
            showControls
              ? "translate-y-0 opacity-100"
              : uiLocked
                ? // Locked: no focus-within escape — the overlay stays away
                  // until the user unlocks.
                  "invisible pointer-events-none translate-y-full opacity-0"
                : "invisible pointer-events-none translate-y-full opacity-0 focus-within:visible focus-within:pointer-events-auto focus-within:translate-y-0 focus-within:opacity-100",
          )}
        >
          {/* The overlay is the seekable timeline (which also hosts the range
              selection) plus the transport strip. Speed is opt-in on top of
              that: it is the one setting you actually change mid-practice, and
              leaving fullscreen for every 0.05x was the whole complaint. */}
          <AnimatePresence initial={false}>
            {speedPanelOpen ? (
              <motion.div
                key="fullscreen-speed"
                className="w-full max-w-2xl overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={collapseTransition}
              >
                <ChartSpeedCard locale={locale} className="bg-black/50 backdrop-blur" />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="w-full max-w-2xl">{timelineBlock}</div>
          <div className="w-full max-w-2xl">{controls}</div>
        </div>
        </>
      )}

      {/* Keyed by title: a different toast exits down while its successor
          springs up, so back-to-back results visibly replace each other. The
          centering -translate-x-1/2 moves into framer's x so it survives the
          animated transform. */}
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.title}
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.95, x: "-50%" }}
            animate={{ opacity: 1, y: 0, scale: 1, x: "-50%", transition: springSoft }}
            exit={{ opacity: 0, y: 12, x: "-50%", transition: { duration: 0.18, ease: EASE_OUT } }}
            className={cn(
              "pointer-events-none fixed bottom-6 left-1/2 z-[60] rounded-md px-3 py-2 text-sm text-white shadow-lg",
              toast.color === "red" ? "bg-red-600" : "bg-emerald-600",
            )}
          >
            <strong className="font-semibold">{toast.title}</strong>
            <span className="ml-2 opacity-90">{toast.message}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default ChartPreview;
