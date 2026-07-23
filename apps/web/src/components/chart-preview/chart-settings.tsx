"use client";

import { useId, useState } from "react";
import {
  ChevronDownIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  VideoIcon,
  Volume2Icon,
} from "lucide-react";
import type { MirrorMode, JudgmentLineDesign } from "@lxns-network/maimai-chart-engine";
import { motion, springSoft } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  configuredDownloadSources,
  downloadSourceCopy,
} from "@/components/site/downloads/download-source-selector";
import { useDownloadsStore } from "@/components/site/downloads/downloads-store";
import { useGameSettingsStore, type FullscreenQuality } from "./store/settings-store";

type Labels = {
  displaySettings: string;
  audioSettings: string;
  videoSettings: string;
  fpsLimit: string;
  fpsUnlimited: string;
  resetOffset: string;
  videoSource: string;
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
    displaySettings: "显示设置",
    audioSettings: "音频设置",
    videoSettings: "视频设置",
    fpsLimit: "帧数限制",
    fpsUnlimited: "无限制",
    resetOffset: "重置偏移",
    videoSource: "视频线路",
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
    displaySettings: "Display settings",
    audioSettings: "Audio settings",
    videoSettings: "Video settings",
    fpsLimit: "FPS limit",
    fpsUnlimited: "Unlimited",
    resetOffset: "Reset offset",
    videoSource: "PV source",
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
    displaySettings: "表示設定",
    audioSettings: "オーディオ設定",
    videoSettings: "ビデオ設定",
    fpsLimit: "フレームレート制限",
    fpsUnlimited: "無制限",
    resetOffset: "オフセットをリセット",
    videoSource: "PV 回線",
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
  pillId,
  children,
}: {
  value: T;
  current: T;
  onSelect: (v: T) => void;
  /** Shared layoutId so the active pill glides between this group's buttons. */
  pillId: string;
  children: React.ReactNode;
}) {
  const active = value === current;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onSelect(value)}
      className={cn(
        "relative",
        // The active look (bg-primary) lives on the gliding pill; the button
        // itself only carries the matching text color.
        active &&
          "border-transparent text-primary-foreground hover:bg-transparent hover:text-primary-foreground dark:bg-transparent dark:hover:bg-transparent",
      )}
    >
      {active ? (
        <motion.span
          layoutId={pillId}
          transition={springSoft}
          aria-hidden="true"
          className="absolute -inset-px rounded-[inherit] bg-primary"
        />
      ) : null}
      <span className="relative z-10">{children}</span>
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

export function ChartSettingsDisplay({ locale = "zh" }: { locale?: Locale }) {
  const s = useGameSettingsStore();
  const t = LABELS[locale];
  // One layoutId per segmented group, so each group's active pill glides
  // independently (and two mounted panels never fight over the same id).
  const pillId = useId();

  return (
    <div className="flex flex-col gap-4">
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
            <SegButton
              key={v}
              value={v}
              current={s.mirrorMode}
              onSelect={s.setMirrorMode}
              pillId={`${pillId}-mirror`}
            >
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
              pillId={`${pillId}-judgment`}
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
        </div>
      </Field>

      <Field label={t.fpsLimit}>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["0", t.fpsUnlimited],
              ["120", "120 FPS"],
              ["60", "60 FPS"],
            ] as [string, string][]
          ).map(([v, label]) => (
            <SegButton
              key={v}
              value={v}
              current={String(s.fpsLimit)}
              onSelect={(value) => s.setFpsLimit(Number(value))}
              pillId={`${pillId}-fps`}
            >
              {label}
            </SegButton>
          ))}
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
              pillId={`${pillId}-quality`}
            >
              {label}
            </SegButton>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function ChartSettingsAudio({ locale = "zh" }: { locale?: Locale }) {
  const s = useGameSettingsStore();
  const t = LABELS[locale];

  return (
    // Column count follows the CARD's width, not the viewport: this section
    // lives both in the narrow sidebar (1 col) and the wide fullscreen panel
    // (2 cols) — a viewport breakpoint overflowed the sidebar.
    <div className="@container flex flex-col gap-4">
      <Field label={t.audio}>
        <div className="grid gap-3 @md:grid-cols-2">
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
              className="h-8 min-w-0 flex-1"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t.resetOffset}
              title={t.resetOffset}
              onClick={() => s.setMusicOffset(0)}
            >
              <RotateCcwIcon aria-hidden="true" />
            </Button>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-24 shrink-0">{t.soundOffset}</span>
            <Input
              type="number"
              value={s.soundOffset}
              onChange={(e) => s.setSoundOffset(Number(e.target.value) || 0)}
              className="h-8 min-w-0 flex-1"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t.resetOffset}
              title={t.resetOffset}
              onClick={() => s.setSoundOffset(0)}
            >
              <RotateCcwIcon aria-hidden="true" />
            </Button>
          </label>
        </div>
      </Field>
    </div>
  );
}

export function ChartSettingsVideo({ locale = "zh" }: { locale?: Locale }) {
  const s = useGameSettingsStore();
  const t = LABELS[locale];
  const pillId = useId();
  const customSources = useDownloadsStore((state) => state.customSources);
  const sourcePicker = getDictionary(locale).downloads.sourcePicker;
  const sources = configuredDownloadSources(customSources);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Toggle active={s.showVideo} onToggle={() => s.setShowVideo(!s.showVideo)}>
          {t.showVideo}
        </Toggle>
      </div>

      {/* Which chart-media mirror serves the PV (upstream's 视频服务器).
          Buttons instead of a Select: SelectContent portals to body, which is
          invisible inside the fullscreened settings panel. */}
      <Field label={t.videoSource}>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <SegButton
              key={source.id}
              value={source.id}
              current={s.videoSourceId}
              onSelect={s.setVideoSourceId}
              pillId={`${pillId}-video-source`}
            >
              {downloadSourceCopy(source, sourcePicker).name}
            </SegButton>
          ))}
        </div>
      </Field>
    </div>
  );
}

function SettingsGroupCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        <ChevronDownIcon
          className={cn("size-4 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {expanded ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

/** Sidebar variant (upstream parity): independent display / audio / video
 *  collapsible groups instead of one gear-toggled panel under the player. */
export function ChartSettingsGroups({ locale = "zh" }: { locale?: Locale }) {
  const t = LABELS[locale];
  return (
    <>
      <SettingsGroupCard
        icon={<SlidersHorizontalIcon className="size-4" aria-hidden="true" />}
        title={t.displaySettings}
      >
        <ChartSettingsDisplay locale={locale} />
      </SettingsGroupCard>
      <SettingsGroupCard
        icon={<Volume2Icon className="size-4" aria-hidden="true" />}
        title={t.audioSettings}
      >
        <ChartSettingsAudio locale={locale} />
      </SettingsGroupCard>
      <SettingsGroupCard
        icon={<VideoIcon className="size-4" aria-hidden="true" />}
        title={t.videoSettings}
      >
        <ChartSettingsVideo locale={locale} />
      </SettingsGroupCard>
    </>
  );
}

export default ChartSettingsGroups;
