"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import {
  DIFFICULTY_COLORS,
  DIFFICULTY_NAMES,
  type ChartDifficulty,
} from "@lxns-network/maimai-chart-engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { beatsToMs } from "./lib/time-conversion";
import { applyDifficulty } from "./apply-difficulty";

const SPEED_STEPS = [1, 0.75, 0.5, 0.25];

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** While playing, the authoritative time lives in playbackTimeRef (updated each
 *  frame by ChartCanvas), not in the store — so poll it via rAF for a live bar. */
function useLiveBeats(): number {
  const isPlaying = useGameStore((s) => s.isPlaying);
  const preciseTime = useGameStore((s) => s.timeline.preciseTime);
  const [playingBeats, setPlayingBeats] = useState(0);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      setPlayingBeats(playbackTimeRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // While paused the authoritative value is the store's preciseTime; only during
  // playback do we poll the live ref.
  return isPlaying ? playingBeats : preciseTime;
}

export function ChartControls() {
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

  const onScrub = (value: number) => {
    setPreciseTime(value, true);
  };

  return (
    <div className="flex flex-col gap-3">
      {diffKeys.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {diffKeys.map((diff) => {
            const active = diff === selectedDifficulty;
            return (
              <button
                key={diff}
                type="button"
                data-difficulty={diff}
                onClick={() => applyDifficulty(diff)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                  active
                    ? "border-transparent text-black"
                    : "border-border/60 text-muted-foreground hover:bg-muted",
                )}
                style={active ? { backgroundColor: DIFFICULTY_COLORS[diff] } : undefined}
              >
                {DIFFICULTY_NAMES[diff]}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          variant="default"
          onClick={togglePlayback}
          disabled={!chartData}
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? (
            <PauseIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
        </Button>

        <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatMs(currentMs)} / {formatMs(totalMs)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(totalBeats, 0.0001)}
          step={0.001}
          value={Math.min(liveBeats, totalBeats)}
          disabled={!chartData}
          onPointerDown={() => {
            wasPlayingRef.current = isPlaying;
            if (isPlaying) togglePlayback();
          }}
          onPointerUp={() => {
            if (wasPlayingRef.current && !useGameStore.getState().isPlaying) togglePlayback();
            wasPlayingRef.current = false;
          }}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-primary"
          aria-label="进度"
        />

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={cycleSpeed}
          className="w-16 shrink-0 tabular-nums"
        >
          {playbackSpeed.toFixed(2)}x
        </Button>

        <Button
          type="button"
          size="icon"
          variant={soundEnabled ? "default" : "outline"}
          onClick={() => setSoundEnabled(!soundEnabled)}
          aria-label={soundEnabled ? "关闭判定音" : "开启判定音"}
        >
          {soundEnabled ? (
            <Volume2Icon aria-hidden="true" />
          ) : (
            <VolumeXIcon aria-hidden="true" />
          )}
        </Button>
      </div>

      {musicLoading ? (
        <p className="text-xs text-muted-foreground">正在加载音频…</p>
      ) : null}
    </div>
  );
}

export default ChartControls;
