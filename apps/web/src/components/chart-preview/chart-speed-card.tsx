"use client";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import {
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  useGameSettingsStore,
} from "./store/settings-store";

type Labels = {
  hiSpeed: string;
  playbackSpeed: string;
  keepHiSpeed: string;
  keepHiSpeedHint: string;
};

const LABELS: Record<Locale, Labels> = {
  zh: {
    hiSpeed: "流速",
    playbackSpeed: "播放速度",
    keepHiSpeed: "保持谱面流速",
    keepHiSpeedHint: "降低播放速度时，自动提高谱面流速，使音符的视觉速度保持不变。",
  },
  en: {
    hiSpeed: "Hi-speed",
    playbackSpeed: "Playback speed",
    keepHiSpeed: "Keep visual hi-speed",
    keepHiSpeedHint:
      "When slowing playback down, hi-speed rises automatically so notes keep the same visual speed.",
  },
  ja: {
    hiSpeed: "ハイスピード",
    playbackSpeed: "再生速度",
    keepHiSpeed: "譜面ハイスピードを維持",
    keepHiSpeedHint:
      "再生速度を下げたとき、ハイスピードを自動的に上げてノーツの見た目の速さを保ちます。",
  },
};

/**
 * Always-visible speed card (lxns-style): hi-speed and continuous playback
 * speed sliders plus the keep-hi-speed link between them. Lives in the desktop
 * sidebar; flows inline on stacked layouts.
 */
export function ChartSpeedCard({
  locale = "zh",
  className,
}: {
  locale?: Locale;
  className?: string;
}) {
  const t = LABELS[locale];
  const hiSpeed = useGameSettingsStore((s) => s.hiSpeed);
  const setHiSpeed = useGameSettingsStore((s) => s.setHiSpeed);
  const alwaysKeepHiSpeed = useGameSettingsStore((s) => s.alwaysKeepHiSpeed);
  const setAlwaysKeepHiSpeed = useGameSettingsStore(
    (s) => s.setAlwaysKeepHiSpeed,
  );
  const playbackSpeed = useGameSettingsStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useGameSettingsStore((s) => s.setPlaybackSpeed);

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border/60 bg-card/40 p-4",
        className,
      )}
    >
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          {t.hiSpeed}
          <span className="font-mono tabular-nums">{hiSpeed.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={3}
          max={9}
          step={0.25}
          value={hiSpeed}
          onChange={(e) => setHiSpeed(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-primary"
          aria-label={t.hiSpeed}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          {t.playbackSpeed}
          <span className="font-mono tabular-nums">
            {playbackSpeed.toFixed(2)}x
          </span>
        </span>
        <input
          type="range"
          min={MIN_PLAYBACK_SPEED}
          max={MAX_PLAYBACK_SPEED}
          step={0.05}
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-primary"
          aria-label={t.playbackSpeed}
        />
      </label>

      <label
        className="flex items-start gap-2 text-xs text-muted-foreground"
        title={t.keepHiSpeedHint}
      >
        <input
          type="checkbox"
          checked={alwaysKeepHiSpeed}
          onChange={(e) => setAlwaysKeepHiSpeed(e.target.checked)}
          className="mt-0.5 size-3.5 cursor-pointer accent-primary"
        />
        <span>
          <span className="block font-medium text-foreground">
            {t.keepHiSpeed}
          </span>
          {t.keepHiSpeedHint}
        </span>
      </label>
    </div>
  );
}
