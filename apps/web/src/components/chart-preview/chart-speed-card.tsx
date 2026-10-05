"use client";

import { cn } from "@astrodx/ui/lib/utils";
import type { Locale } from "@/lib/i18n";
import {
  MAX_PLAYBACK_SPEED,
  MAX_SLIDE_DELAY,
  MIN_PLAYBACK_SPEED,
  MIN_SLIDE_DELAY,
  useGameSettingsStore,
} from "./store/settings-store";

type Labels = {
  hiSpeed: string;
  playbackSpeed: string;
  slideDelay: string;
  slideDelayHint: string;
  keepHiSpeed: string;
  keepHiSpeedHint: string;
};

const LABELS: Record<Locale, Labels> = {
  zh: {
    hiSpeed: "流速",
    playbackSpeed: "播放速度",
    slideDelay: "星星延迟",
    slideDelayHint: "调整星星轨迹提前或推后出现，不改变判定时刻。",
    keepHiSpeed: "保持谱面流速",
    keepHiSpeedHint: "降低播放速度时，自动提高谱面流速，使音符的视觉速度保持不变。",
  },
  en: {
    hiSpeed: "Hi-speed",
    playbackSpeed: "Playback speed",
    slideDelay: "Slide delay",
    slideDelayHint: "Shows slide tracks earlier or later without moving their judgment.",
    keepHiSpeed: "Keep visual hi-speed",
    keepHiSpeedHint:
      "When slowing playback down, hi-speed rises automatically so notes keep the same visual speed.",
  },
  ja: {
    hiSpeed: "ハイスピード",
    playbackSpeed: "再生速度",
    slideDelay: "スライド表示タイミング",
    slideDelayHint: "スライドのガイドを早め・遅めに表示します。判定のタイミングは変わりません。",
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
  const slideDelay = useGameSettingsStore((s) => s.slideDelay);
  const setSlideDelay = useGameSettingsStore((s) => s.setSlideDelay);

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

      <label className="flex flex-col gap-1.5" title={t.slideDelayHint}>
        <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          {t.slideDelay}
          <span className="font-mono tabular-nums">
            {slideDelay > 0 ? "+" : ""}
            {slideDelay.toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          min={MIN_SLIDE_DELAY}
          max={MAX_SLIDE_DELAY}
          step={0.1}
          value={slideDelay}
          onChange={(e) => setSlideDelay(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-primary"
          aria-label={t.slideDelay}
          aria-description={t.slideDelayHint}
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
