"use client";

import { useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FilmIcon,
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
import {
  DIFFICULTY_COLORS,
  DIFFICULTY_NAMES,
  type ChartDifficulty,
} from "@lxns-network/maimai-chart-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGameStore } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { beatsToMs } from "./lib/time-conversion";
import { formatClock } from "./lib/format";
import { applyDifficulty } from "./apply-difficulty";
import { useLiveBeats } from "./hooks/use-live-beats";
import { EXPORT_FRAME_EVENT, COPY_FRAME_EVENT } from "./chart-canvas";

const SPEED_STEPS = [1, 0.75, 0.5, 0.25];

export type ChartControlsProps = {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Toggle the GIF range-selection overlay. */
  onToggleGifRange: () => void;
  gifRangeMode: boolean;
  gifExporting: boolean;
  gifProgress: number;
  /** Difficulty slot (2–6) → level string, from the catalog. */
  levels?: Record<number, string>;
};

export function ChartControls({
  settingsOpen,
  onToggleSettings,
  isFullscreen,
  onToggleFullscreen,
  onToggleGifRange,
  gifRangeMode,
  gifExporting,
  gifProgress,
  levels,
}: ChartControlsProps) {
  const isPlaying = useGameStore((s) => s.isPlaying);
  const togglePlayback = useGameStore((s) => s.togglePlayback);
  const setPreciseTime = useGameStore((s) => s.setPreciseTime);
  const setPlaybackSpeed = useGameStore((s) => s.setPlaybackSpeed);
  const playbackSpeed = useGameStore((s) => s.playbackSpeed);
  const chartData = useGameStore((s) => s.chartData);
  const selectedDifficulty = useGameStore((s) => s.selectedDifficulty);
  const availableDifficulties = useGameStore((s) => s.availableDifficulties);
  const totalMeasures = useGameStore((s) => s.timeline.totalMeasures);
  const beatsPerMeasure = useGameStore((s) => s.timeline.beatsPerMeasure);
  const musicLoading = useGameStore((s) => s.musicLoading);
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

  return (
    <div className="flex flex-col gap-3">
      {diffKeys.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {diffKeys.map((diff) => {
            const active = diff === selectedDifficulty;
            const level = levels?.[diff];
            return (
              <button
                key={diff}
                type="button"
                onClick={() => applyDifficulty(diff)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                  active
                    ? "border-transparent text-black"
                    : "border-border/60 text-muted-foreground hover:bg-muted",
                )}
                style={active ? { backgroundColor: DIFFICULTY_COLORS[diff] } : undefined}
              >
                {DIFFICULTY_NAMES[diff]}
                {level ? (
                  <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>
                    {level}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Transport */}
      <div className="flex items-center gap-2">
        <Button type="button" size="icon" variant="outline" onClick={() => stepMeasure(-1)} disabled={disabled} aria-label="上一小节">
          <SkipBackIcon aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={() => stepPosition(-1)} disabled={disabled} aria-label="上一位置">
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="default" onClick={togglePlayback} disabled={disabled} aria-label={isPlaying ? "暂停" : "播放"}>
          {isPlaying ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={() => stepPosition(1)} disabled={disabled} aria-label="下一位置">
          <ChevronRightIcon aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={() => stepMeasure(1)} disabled={disabled} aria-label="下一小节">
          <SkipForwardIcon aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={restartCurrentMeasure} disabled={disabled} aria-label="重播当前小节">
          <RotateCcwIcon aria-hidden="true" />
        </Button>

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
          className="h-1.5 flex-1 cursor-pointer accent-primary"
          aria-label="进度"
        />

        <Button type="button" size="sm" variant="outline" onClick={cycleSpeed} className="w-16 shrink-0 tabular-nums">
          {playbackSpeed.toFixed(2)}x
        </Button>
      </div>

      {/* Utilities */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant={soundEnabled ? "default" : "outline"}
          onClick={() => setSoundEnabled(!soundEnabled)}
          aria-label={soundEnabled ? "关闭判定音" : "开启判定音"}
        >
          {soundEnabled ? <Volume2Icon aria-hidden="true" /> : <VolumeXIcon aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant={settingsOpen ? "default" : "outline"}
          onClick={onToggleSettings}
          aria-label="设置"
          aria-pressed={settingsOpen}
        >
          <SettingsIcon aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={onToggleFullscreen} aria-label={isFullscreen ? "退出全屏" : "全屏"}>
          {isFullscreen ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}
        </Button>

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
          aria-label="复制当前帧"
        >
          <CopyIcon aria-hidden="true" />
        </Button>
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
      </div>

      {musicLoading ? <p className="text-xs text-muted-foreground">正在加载音频…</p> : null}
    </div>
  );
}

export default ChartControls;
