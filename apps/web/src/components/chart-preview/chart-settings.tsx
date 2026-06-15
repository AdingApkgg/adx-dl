"use client";

import type { MirrorMode, JudgmentLineDesign } from "@lxns-network/maimai-chart-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { useGameSettingsStore, type FullscreenQuality } from "./store/settings-store";

type Labels = {
  hiSpeed: string;
  keepHiSpeed: string;
  mirror: string;
  mirrorNone: string;
  mirrorH: string;
  mirrorV: string;
  mirror180: string;
  judgmentLine: string;
  jlBlind: string;
  jlNoLine: string;
  jlSimple: string;
  jlSensor: string;
  effects: string;
  slideRotation: string;
  pinkSlide: string;
  highlightEx: string;
  normalBreakSlide: string;
  fireworks: string;
  hitEffect: string;
  showVideo: string;
  audio: string;
  musicVolume: string;
  soundVolume: string;
  musicOffset: string;
  soundOffset: string;
  quality: string;
  qSmooth: string;
  qBalanced: string;
  qHigh: string;
};

const LABELS: Record<Locale, Labels> = {
  zh: {
    hiSpeed: "流速",
    keepHiSpeed: "锁定流速",
    mirror: "镜像",
    mirrorNone: "无",
    mirrorH: "左右",
    mirrorV: "上下",
    mirror180: "旋转",
    judgmentLine: "判定线",
    jlBlind: "隐藏",
    jlNoLine: "无线",
    jlSimple: "简约",
    jlSensor: "感应区",
    effects: "效果",
    slideRotation: "Slide 箭头旋转",
    pinkSlide: "粉色 Slide 头",
    highlightEx: "高亮 EX",
    normalBreakSlide: "Break Slide 常规色",
    fireworks: "烟花",
    hitEffect: "打击特效",
    showVideo: "背景 PV",
    audio: "音频",
    musicVolume: "音乐音量",
    soundVolume: "判定音音量",
    musicOffset: "音乐偏移 (ms)",
    soundOffset: "判定音偏移 (ms)",
    quality: "全屏画质",
    qSmooth: "流畅",
    qBalanced: "均衡",
    qHigh: "高清",
  },
  en: {
    hiSpeed: "Hi-Speed",
    keepHiSpeed: "Lock hi-speed",
    mirror: "Mirror",
    mirrorNone: "None",
    mirrorH: "Horiz.",
    mirrorV: "Vert.",
    mirror180: "Rotate",
    judgmentLine: "Judgment line",
    jlBlind: "Hidden",
    jlNoLine: "No line",
    jlSimple: "Simple",
    jlSensor: "Sensor",
    effects: "Effects",
    slideRotation: "Slide arrow rotation",
    pinkSlide: "Pink slide star",
    highlightEx: "Highlight EX",
    normalBreakSlide: "Normal-color break slide",
    fireworks: "Fireworks",
    hitEffect: "Hit effect",
    showVideo: "Background PV",
    audio: "Audio",
    musicVolume: "Music volume",
    soundVolume: "Answer SFX volume",
    musicOffset: "Music offset (ms)",
    soundOffset: "SFX offset (ms)",
    quality: "Fullscreen quality",
    qSmooth: "Smooth",
    qBalanced: "Balanced",
    qHigh: "High",
  },
  ja: {
    hiSpeed: "ハイスピード",
    keepHiSpeed: "ハイスピード固定",
    mirror: "ミラー",
    mirrorNone: "なし",
    mirrorH: "左右",
    mirrorV: "上下",
    mirror180: "回転",
    judgmentLine: "判定ライン",
    jlBlind: "非表示",
    jlNoLine: "ラインなし",
    jlSimple: "シンプル",
    jlSensor: "センサー",
    effects: "エフェクト",
    slideRotation: "スライド矢印回転",
    pinkSlide: "ピンクスライド",
    highlightEx: "EX 強調",
    normalBreakSlide: "ブレイクスライド通常色",
    fireworks: "花火",
    hitEffect: "ヒットエフェクト",
    showVideo: "背景 PV",
    audio: "オーディオ",
    musicVolume: "音楽音量",
    soundVolume: "判定音音量",
    musicOffset: "音楽オフセット (ms)",
    soundOffset: "判定音オフセット (ms)",
    quality: "全画面画質",
    qSmooth: "スムーズ",
    qBalanced: "バランス",
    qHigh: "高画質",
  },
};

function SegButton<T extends string>({
  value,
  current,
  onSelect,
  children,
}: {
  value: T;
  current: T;
  onSelect: (v: T) => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={value === current ? "default" : "outline"}
      onClick={() => onSelect(value)}
    >
      {children}
    </Button>
  );
}

function Toggle({
  active,
  onToggle,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onToggle}
      aria-pressed={active}
    >
      {children}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ChartSettings({ locale = "zh", className }: { locale?: Locale; className?: string }) {
  const s = useGameSettingsStore();
  const t = LABELS[locale];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Field label={`${t.hiSpeed}: ${s.hiSpeed.toFixed(1)}`}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={3}
            max={9}
            step={0.5}
            value={s.hiSpeed}
            onChange={(e) => s.setHiSpeed(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-primary"
            aria-label={t.hiSpeed}
          />
          <Toggle active={s.alwaysKeepHiSpeed} onToggle={() => s.setAlwaysKeepHiSpeed(!s.alwaysKeepHiSpeed)}>
            {t.keepHiSpeed}
          </Toggle>
        </div>
      </Field>

      <Field label={t.mirror}>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["none", t.mirrorNone],
              ["horizontal", t.mirrorH],
              ["vertical", t.mirrorV],
              ["rotate180", t.mirror180],
            ] as [MirrorMode, string][]
          ).map(([v, label]) => (
            <SegButton key={v} value={v} current={s.mirrorMode} onSelect={s.setMirrorMode}>
              {label}
            </SegButton>
          ))}
        </div>
      </Field>

      <Field label={t.judgmentLine}>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["blind", t.jlBlind],
              ["noLine", t.jlNoLine],
              ["simple", t.jlSimple],
              ["sensor", t.jlSensor],
            ] as [JudgmentLineDesign, string][]
          ).map(([v, label]) => (
            <SegButton
              key={v}
              value={v}
              current={s.judgmentLineDesign}
              onSelect={s.setJudgmentLineDesign}
            >
              {label}
            </SegButton>
          ))}
        </div>
      </Field>

      <Field label={t.effects}>
        <div className="flex flex-wrap gap-1.5">
          <Toggle active={s.slideRotation} onToggle={() => s.setSlideRotation(!s.slideRotation)}>
            {t.slideRotation}
          </Toggle>
          <Toggle active={s.pinkSlideStart} onToggle={() => s.setPinkSlideStart(!s.pinkSlideStart)}>
            {t.pinkSlide}
          </Toggle>
          <Toggle active={s.highlightExNotes} onToggle={() => s.setHighlightExNotes(!s.highlightExNotes)}>
            {t.highlightEx}
          </Toggle>
          <Toggle
            active={s.normalColorBreakSlide}
            onToggle={() => s.setNormalColorBreakSlide(!s.normalColorBreakSlide)}
          >
            {t.normalBreakSlide}
          </Toggle>
          <Toggle active={s.showFireworks} onToggle={() => s.setShowFireworks(!s.showFireworks)}>
            {t.fireworks}
          </Toggle>
          <Toggle active={s.showHitEffect} onToggle={() => s.setShowHitEffect(!s.showHitEffect)}>
            {t.hitEffect}
          </Toggle>
          <Toggle active={s.showVideo} onToggle={() => s.setShowVideo(!s.showVideo)}>
            {t.showVideo}
          </Toggle>
        </div>
      </Field>

      <Field label={t.audio}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-24 shrink-0">{t.musicVolume}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.musicVolume}
              onChange={(e) => s.setMusicVolume(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer accent-primary"
              aria-label={t.musicVolume}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-24 shrink-0">{t.soundVolume}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.soundVolume}
              onChange={(e) => s.setSoundVolume(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer accent-primary"
              aria-label={t.soundVolume}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-24 shrink-0">{t.musicOffset}</span>
            <Input
              type="number"
              value={s.musicOffset}
              onChange={(e) => s.setMusicOffset(Number(e.target.value) || 0)}
              className="h-8"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-24 shrink-0">{t.soundOffset}</span>
            <Input
              type="number"
              value={s.soundOffset}
              onChange={(e) => s.setSoundOffset(Number(e.target.value) || 0)}
              className="h-8"
            />
          </label>
        </div>
      </Field>

      <Field label={t.quality}>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["smooth", t.qSmooth],
              ["balanced", t.qBalanced],
              ["high", t.qHigh],
            ] as [FullscreenQuality, string][]
          ).map(([v, label]) => (
            <SegButton
              key={v}
              value={v}
              current={s.fullscreenQuality}
              onSelect={s.setFullscreenQuality}
            >
              {label}
            </SegButton>
          ))}
        </div>
      </Field>
    </div>
  );
}

export default ChartSettings;
