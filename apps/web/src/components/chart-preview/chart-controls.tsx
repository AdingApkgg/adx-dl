"use client";

import { useRef, type ComponentProps } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FilmIcon,
  Loader2Icon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { DIFFICULTY_NAMES, type ChartDifficulty } from "@lxns-network/maimai-chart-engine";
import { AnimatePresence, motion, springSoft } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { difficultyTone, DIFFICULTY_TONE_CLASS } from "@/lib/catalog-shared";
import type { SiteDictionary } from "@/lib/i18n";
import { useGameStore } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { beatsToMs } from "./lib/time-conversion";
import { formatClock } from "./lib/format";
import { applyDifficulty } from "./apply-difficulty";
import { useLiveBeats } from "./hooks/use-live-beats";
import { EXPORT_FRAME_EVENT, COPY_FRAME_EVENT } from "./chart-canvas";

type PreviewDict = SiteDictionary["preview"];

// framer-motion 12 removed the motion(Component) call form.
const MotionButton = motion.create(Button);

/** Transport icon button with a springy press-down. */
function TapButton(props: ComponentProps<typeof MotionButton>) {
  return <MotionButton whileTap={{ scale: 0.92 }} transition={springSoft} {...props} />;
}

const SPEED_STEPS = [1, 0.75, 0.5, 0.25];

export type ChartControlsProps = {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Hide the fullscreen button where the Fullscreen API is unavailable (iOS Safari). */
  fullscreenSupported: boolean;
  /** Toggle the GIF range-selection overlay. */
  onToggleGifRange: () => void;
  gifRangeMode: boolean;
  gifExporting: boolean;
  gifProgress: number;
  /** Difficulty slot (2–6) → level string, from the catalog. */
  levels?: Record<number, string>;
  t: PreviewDict;
};

export function ChartControls({
  settingsOpen,
  onToggleSettings,
  isFullscreen,
  onToggleFullscreen,
  fullscreenSupported,
  onToggleGifRange,
  gifRangeMode,
  gifExporting,
  gifProgress,
  levels,
  t,
}: ChartControlsProps) {
  const isPlaying = useGameStore((s) => s.isPlaying);
  const togglePlayback = useGameStore((s) => s.togglePlayback);
  const pause = useGameStore((s) => s.pause);
  const setPreciseTime = useGameStore((s) => s.setPreciseTime);
  const setPlaybackSpeed = useGameStore((s) => s.setPlaybackSpeed);
  const playbackSpeed = useGameStore((s) => s.playbackSpeed);
  const chartData = useGameStore((s) => s.chartData);
  const selectedDifficulty = useGameStore((s) => s.selectedDifficulty);
  const availableDifficulties = useGameStore((s) => s.availableDifficulties);
  const totalMeasures = useGameStore((s) => s.timeline.totalMeasures);
  const beatsPerMeasure = useGameStore((s) => s.timeline.beatsPerMeasure);
  const musicLoading = useGameStore((s) => s.musicLoading);
  const musicError = useGameStore((s) => s.musicError);
  const pendingPlay = useGameStore((s) => s.pendingPlay);
  const stepMeasure = useGameStore((s) => s.stepMeasure);
  const stepPosition = useGameStore((s) => s.stepPosition);
  const restartCurrentMeasure = useGameStore((s) => s.restartCurrentMeasure);

  const soundEnabled = useGameSettingsStore((s) => s.soundEnabled);
  const setSoundEnabled = useGameSettingsStore((s) => s.setSoundEnabled);

  const liveBeats = useLiveBeats();
  const wasPlayingRef = useRef(false);

  const totalBeats = totalMeasures * beatsPerMeasure;
  const bpmEvents = chartData?.bpmEvents ?? null;
  const bpm = chartData?.bpm ?? 120;
  const currentMs = beatsToMs(liveBeats, bpmEvents, bpm);
  const totalMs = beatsToMs(totalBeats, bpmEvents, bpm);

  const diffKeys = (Object.keys(availableDifficulties) as unknown as string[])
    .map(Number)
    .filter((d) => availableDifficulties[d as ChartDifficulty])
    .sort((a, b) => a - b) as ChartDifficulty[];

  const cycleSpeed = () => {
    const idx = SPEED_STEPS.indexOf(playbackSpeed);
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length] ?? 1;
    setPlaybackSpeed(next);
  };

  const disabled = !chartData;
  // Audio is still downloading after a play request: show a spinner on the play
  // button; clicking again cancels the pending playback.
  const audioPending = pendingPlay && !isPlaying;

  const retryAudio = () => useGameStore.getState().play();

  const playWithoutAudio = () => {
    const store = useGameStore.getState();
    // Dropping the URL clears musicLoaded/musicError, so play() no longer waits.
    store.setMusicUrl("");
    store.play();
  };

  return (
    <div className="flex flex-col gap-3">
      {diffKeys.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {diffKeys.map((diff) => {
            const active = diff === selectedDifficulty;
            const level = levels?.[diff];
            const tone = difficultyTone({ slot: diff, name: DIFFICULTY_NAMES[diff] });
            return (
              <button
                key={diff}
                type="button"
                onClick={() => applyDifficulty(diff)}
                aria-pressed={active}
                className={cn(
                  "relative flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                  active
                    ? // Text color comes from the tone class; the tone background/
                      // border live on the gliding pill below.
                      cn(DIFFICULTY_TONE_CLASS[tone], "border-transparent bg-transparent")
                    : "border-border/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="preview-difficulty-pill"
                    transition={springSoft}
                    aria-hidden="true"
                    // layoutId remounts crossfade old/new tone colors while the
                    // box glides, so per-tone colors never interpolate (smear).
                    className={cn(
                      "absolute -inset-px rounded-md border ring-1 ring-current",
                      DIFFICULTY_TONE_CLASS[tone],
                    )}
                  />
                ) : null}
                <span className="relative z-10 flex items-center gap-1.5">
                  {DIFFICULTY_NAMES[diff]}
                  {level ? (
                    <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>
                      {level}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Transport: wraps on narrow screens so the seek slider drops to its own
          full-width row instead of being clipped by the card. */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <TapButton type="button" size="icon" variant="outline" onClick={() => stepMeasure(-1)} disabled={disabled} aria-label={t.prevMeasure}>
          <SkipBackIcon aria-hidden="true" />
        </TapButton>
        <TapButton type="button" size="icon" variant="outline" onClick={() => stepPosition(-1)} disabled={disabled} aria-label={t.prevPosition}>
          <ChevronLeftIcon aria-hidden="true" />
        </TapButton>
        <TapButton
          type="button"
          size="icon"
          variant="default"
          // relative: popLayout anchors the exiting icon to the button itself.
          className="relative"
          onClick={() => (audioPending ? pause() : togglePlayback())}
          disabled={disabled}
          aria-label={isPlaying ? t.pause : audioPending ? t.audioLoading : t.play}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={audioPending ? "loading" : isPlaying ? "pause" : "play"}
              className="flex"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={springSoft}
            >
              {audioPending ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : isPlaying ? (
                <PauseIcon aria-hidden="true" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
            </motion.span>
          </AnimatePresence>
        </TapButton>
        <TapButton type="button" size="icon" variant="outline" onClick={() => stepPosition(1)} disabled={disabled} aria-label={t.nextPosition}>
          <ChevronRightIcon aria-hidden="true" />
        </TapButton>
        <TapButton type="button" size="icon" variant="outline" onClick={() => stepMeasure(1)} disabled={disabled} aria-label={t.nextMeasure}>
          <SkipForwardIcon aria-hidden="true" />
        </TapButton>
        <TapButton type="button" size="icon" variant="outline" onClick={restartCurrentMeasure} disabled={disabled} aria-label={t.replayMeasure}>
          <RotateCcwIcon aria-hidden="true" />
        </TapButton>

        <span className="ml-1 w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatClock(currentMs)} / {formatClock(totalMs)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(totalBeats, 0.0001)}
          step={0.001}
          value={Math.min(liveBeats, totalBeats)}
          disabled={disabled}
          onPointerDown={() => {
            wasPlayingRef.current = isPlaying;
            if (isPlaying) togglePlayback();
          }}
          onPointerUp={() => {
            if (wasPlayingRef.current && !useGameStore.getState().isPlaying) togglePlayback();
            wasPlayingRef.current = false;
          }}
          onChange={(e) => setPreciseTime(Number(e.target.value), true)}
          className="order-last h-1.5 basis-full cursor-pointer accent-primary sm:order-none sm:flex-1 sm:basis-auto"
          aria-label={t.progress}
        />

        <Button type="button" size="sm" variant="outline" onClick={cycleSpeed} className="relative w-16 shrink-0 overflow-hidden tabular-nums">
          {/* Slot-machine slide: the new speed rolls up over the old one. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={playbackSpeed}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={springSoft}
            >
              {playbackSpeed.toFixed(2)}x
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>

      {/* Utilities */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant={soundEnabled ? "default" : "outline"}
          onClick={() => setSoundEnabled(!soundEnabled)}
          aria-label={soundEnabled ? t.soundOff : t.soundOn}
        >
          {soundEnabled ? <Volume2Icon aria-hidden="true" /> : <VolumeXIcon aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant={settingsOpen ? "default" : "outline"}
          onClick={onToggleSettings}
          aria-label={t.settings}
          aria-pressed={settingsOpen}
        >
          <SettingsIcon aria-hidden="true" />
        </Button>
        {fullscreenSupported ? (
          <Button type="button" size="icon" variant="outline" onClick={onToggleFullscreen} aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}>
            {isFullscreen ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}
          </Button>
        ) : null}

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => window.dispatchEvent(new Event(EXPORT_FRAME_EVENT))}
          disabled={disabled}
        >
          <DownloadIcon data-icon="inline-start" aria-hidden="true" />
          PNG
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => window.dispatchEvent(new Event(COPY_FRAME_EVENT))}
          disabled={disabled}
          aria-label={t.copyFrame}
        >
          <CopyIcon aria-hidden="true" />
        </Button>
        {/* The range overlay + export bar only exist outside fullscreen, so the
            GIF entry point would be a dead end here. */}
        {!isFullscreen ? (
          <Button
            type="button"
            size="sm"
            variant={gifRangeMode ? "default" : "outline"}
            onClick={onToggleGifRange}
            disabled={disabled || gifExporting}
            aria-pressed={gifRangeMode}
          >
            <FilmIcon data-icon="inline-start" aria-hidden="true" />
            {gifExporting ? `GIF ${Math.round(gifProgress * 100)}%` : "GIF"}
          </Button>
        ) : null}
      </div>

      {musicError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-destructive">{t.audioFailedBody}</span>
          <Button type="button" size="xs" variant="outline" onClick={retryAudio}>
            {t.retry}
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={playWithoutAudio}>
            {t.playWithoutAudio}
          </Button>
        </div>
      ) : musicLoading || audioPending ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t.audioLoading}
        </p>
      ) : null}
    </div>
  );
}

export default ChartControls;
