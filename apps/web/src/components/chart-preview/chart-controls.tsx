"use client";

import { useRef, useState, type ComponentProps } from "react";
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  Link2Icon,
  DownloadIcon,
  FilmIcon,
  Loader2Icon,
  MaximizeIcon,
  MinimizeIcon,
  GaugeIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwSquareIcon,
  Share2Icon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { DIFFICULTY_NAMES, type ChartDifficulty } from "@lxns-network/maimai-chart-engine";
import { AnimatePresence, motion, springSoft } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, TAP_TARGET_44 } from "@/lib/utils";
import { difficultyTone, DIFFICULTY_TONE_CLASS } from "@/lib/catalog-shared";
import type { SiteDictionary } from "@/lib/i18n";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { applyDifficulty } from "./apply-difficulty";
import {
  canShareFrameFiles,
  COPY_FRAME_EVENT,
  EXPORT_FRAME_EVENT,
  SHARE_FRAME_EVENT,
} from "./chart-canvas";

type PreviewDict = SiteDictionary["preview"];

// framer-motion 12 removed the motion(Component) call form.
const MotionButton = motion.create(Button);

/** Transport icon button with a springy press-down. The 32px visual box is far
 *  under the 44pt touch minimum, so every one of them carries the invisible
 *  hit-area expansion (the strip's gap-3 is sized to keep those from colliding). */
function TapButton({ className, ...props }: ComponentProps<typeof MotionButton>) {
  return (
    <MotionButton
      whileTap={{ scale: 0.92 }}
      transition={springSoft}
      className={cn(TAP_TARGET_44, className)}
      {...props}
    />
  );
}

/** Hover label for the icon-only strip (upstream parity). The container
 *  override keeps tooltips visible inside the Fullscreen API element. */
function Tip({
  label,
  container,
  children,
}: {
  label: string;
  container?: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent container={container}>{label}</TooltipContent>
    </Tooltip>
  );
}

export type ChartControlsProps = {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Toggle the A–B range-selection overlay (shared by the loop and GIF export). */
  onToggleRangeMode: () => void;
  rangeMode: boolean;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  /** Fullscreen-only speed panel (the sidebar card is not reachable there). */
  speedPanelOpen: boolean;
  onToggleSpeedPanel: () => void;
  gifExporting: boolean;
  gifProgress: number;
  /** Difficulty slot (2–6) → level string, from the catalog. */
  levels?: Record<number, string>;
  /** Portal target for the export menu — the fullscreen element while
   *  fullscreen, where a body portal would render outside the visible tree. */
  menuContainer?: HTMLElement | null;
  t: PreviewDict;
};

export function ChartControls({
  isFullscreen,
  onToggleFullscreen,
  onToggleRangeMode,
  rangeMode,
  loopEnabled,
  onToggleLoop,
  speedPanelOpen,
  onToggleSpeedPanel,
  gifExporting,
  gifProgress,
  levels,
  menuContainer,
  t,
}: ChartControlsProps) {
  const isPlaying = useGameStore((s) => s.isPlaying);
  const togglePlayback = useGameStore((s) => s.togglePlayback);
  const pause = useGameStore((s) => s.pause);
  const chartData = useGameStore((s) => s.chartData);
  const musicLoading = useGameStore((s) => s.musicLoading);
  const musicError = useGameStore((s) => s.musicError);
  const pendingPlay = useGameStore((s) => s.pendingPlay);
  const stepMeasure = useGameStore((s) => s.stepMeasure);
  const stepPosition = useGameStore((s) => s.stepPosition);
  const restartCurrentMeasure = useGameStore((s) => s.restartCurrentMeasure);

  const soundEnabled = useGameSettingsStore((s) => s.soundEnabled);
  const setSoundEnabled = useGameSettingsStore((s) => s.setSoundEnabled);
  const viewRotation = useGameSettingsStore((s) => s.viewRotation);
  const cycleViewRotation = useGameSettingsStore((s) => s.cycleViewRotation);

  const [timeUrlCopied, setTimeUrlCopied] = useState(false);
  const timeUrlResetTimer = useRef<number | undefined>(undefined);
  // Web Share support is a platform constant — probe once per mount.
  const [canShareFrames] = useState(canShareFrameFiles);
  const copyTimeUrl = async () => {
    // Deep link back into this preview at the current beat (upstream parity):
    // ?preview=1 reopens the overlay, ?beat= is consumed by chart-preview.
    const url = new URL(window.location.href);
    url.searchParams.set("preview", "1");
    // Read the live position off the shared ref at click time — subscribing
    // via useLiveBeats would re-render the whole control strip every frame.
    url.searchParams.set(
      "beat",
      Math.max(0, playbackTimeRef.current).toFixed(2)
    );
    // The beat alone is not a moment: the same timestamp on EXPERT and on
    // MASTER is two different charts, so the difficulty travels with it.
    const currentDifficulty = useGameStore.getState().selectedDifficulty;
    if (currentDifficulty !== null) {
      url.searchParams.set("diff", String(currentDifficulty));
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      setTimeUrlCopied(true);
      window.clearTimeout(timeUrlResetTimer.current);
      timeUrlResetTimer.current = window.setTimeout(
        () => setTimeUrlCopied(false),
        2000
      );
    } catch {
      // Clipboard denied (permissions/insecure context) — nothing to signal.
    }
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
      {/* Desktop moves the difficulty picker into the sidebar (see
          chart-preview.tsx) — this inline copy serves the stacked layout. */}
      <ChartDifficultyPicker
        levels={levels}
        className="lg:hidden"
        pillLayoutId="preview-difficulty-pill-inline"
      />

      {/* One centered transport strip (upstream parity): steps + play, then
          the utility icons. Seeking lives on the density timeline's playhead
          and the export actions fold into the camera menu. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Tip label={t.prevMeasure} container={menuContainer}>
          <TapButton type="button" size="icon" variant="outline" onClick={() => stepMeasure(-1)} disabled={disabled} aria-label={t.prevMeasure}>
            <SkipBackIcon aria-hidden="true" />
          </TapButton>
        </Tip>
        <Tip label={t.prevPosition} container={menuContainer}>
          <TapButton type="button" size="icon" variant="outline" onClick={() => stepPosition(-1)} disabled={disabled} aria-label={t.prevPosition}>
            <ChevronLeftIcon aria-hidden="true" />
          </TapButton>
        </Tip>
        <Tip
          label={isPlaying ? t.pause : audioPending ? t.audioLoading : t.play}
          container={menuContainer}
        >
        <TapButton
          type="button"
          size="icon"
          variant="default"
          // relative: popLayout anchors the exiting icon to the button itself.
          className="relative size-11 rounded-full"
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
        </Tip>
        <Tip label={t.nextPosition} container={menuContainer}>
          <TapButton type="button" size="icon" variant="outline" onClick={() => stepPosition(1)} disabled={disabled} aria-label={t.nextPosition}>
            <ChevronRightIcon aria-hidden="true" />
          </TapButton>
        </Tip>
        <Tip label={t.nextMeasure} container={menuContainer}>
          <TapButton type="button" size="icon" variant="outline" onClick={() => stepMeasure(1)} disabled={disabled} aria-label={t.nextMeasure}>
            <SkipForwardIcon aria-hidden="true" />
          </TapButton>
        </Tip>

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <Tip label={t.replayMeasure} container={menuContainer}>
          <TapButton type="button" size="icon" variant="outline" onClick={restartCurrentMeasure} disabled={disabled} aria-label={t.replayMeasure}>
            <RotateCcwIcon aria-hidden="true" />
          </TapButton>
        </Tip>
        <Tip label={soundEnabled ? t.soundOff : t.soundOn} container={menuContainer}>
          <Button
            type="button"
            size="icon"
            className={TAP_TARGET_44}
            variant={soundEnabled ? "default" : "outline"}
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? t.soundOff : t.soundOn}
          >
            {soundEnabled ? <Volume2Icon aria-hidden="true" /> : <VolumeXIcon aria-hidden="true" />}
          </Button>
        </Tip>
        <Tip label={loopEnabled ? t.loopRangeOff : t.loopRange} container={menuContainer}>
          <Button
            type="button"
            size="icon"
            className={TAP_TARGET_44}
            variant={loopEnabled ? "default" : "outline"}
            onClick={onToggleLoop}
            disabled={disabled}
            aria-pressed={loopEnabled}
            aria-label={loopEnabled ? t.loopRangeOff : t.loopRange}
          >
            <RepeatIcon aria-hidden="true" />
          </Button>
        </Tip>

        {/* modal={false}: the default modal menu scroll-locks the whole page
            (react-remove-scroll) on open — a visible hitch on this heavy
            preview DOM, and pointless inside the already-modal overlay. */}
        <DropdownMenu modal={false}>
          <Tip label={t.exportMenu} container={menuContainer}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                className={TAP_TARGET_44}
                variant={rangeMode || gifExporting ? "default" : "outline"}
                disabled={disabled}
                aria-label={t.exportMenu}
              >
                <CameraIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="center" container={menuContainer} instant>
            <DropdownMenuItem
              onSelect={() => window.dispatchEvent(new Event(EXPORT_FRAME_EVENT))}
            >
              <DownloadIcon aria-hidden="true" />
              {t.saveFrame}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => window.dispatchEvent(new Event(COPY_FRAME_EVENT))}
            >
              <CopyIcon aria-hidden="true" />
              {t.copyFrame}
            </DropdownMenuItem>
            {canShareFrames ? (
              <DropdownMenuItem
                onSelect={() => window.dispatchEvent(new Event(SHARE_FRAME_EVENT))}
              >
                <Share2Icon aria-hidden="true" />
                {t.shareFrame}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={gifExporting}
              onSelect={onToggleRangeMode}
              className={rangeMode ? "text-destructive" : undefined}
            >
              <FilmIcon aria-hidden="true" />
              {gifExporting
                ? t.exportingPercent(Math.round(gifProgress * 100))
                : rangeMode
                  ? t.gifCancel
                  : t.exportGif}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tip label={t.copyTimeUrl} container={menuContainer}>
          <Button
            type="button"
            size="icon"
            className={TAP_TARGET_44}
            variant="outline"
            onClick={() => void copyTimeUrl()}
            disabled={disabled}
            aria-label={t.copyTimeUrl}
          >
            {timeUrlCopied ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <Link2Icon aria-hidden="true" />
            )}
          </Button>
        </Tip>
        <Tip label={t.rotateView(viewRotation)} container={menuContainer}>
          <Button
            type="button"
            size="icon"
            className={TAP_TARGET_44}
            variant={viewRotation !== 0 ? "default" : "outline"}
            onClick={cycleViewRotation}
            aria-label={t.rotateView(viewRotation)}
          >
            <RotateCwSquareIcon aria-hidden="true" />
          </Button>
        </Tip>
        {/* Fullscreen-only: everywhere else the speed card is already on screen
            in the sidebar (or stacked under the player). */}
        {isFullscreen ? (
          <Tip label={t.speedPanel} container={menuContainer}>
            <Button
              type="button"
              size="icon"
              className={TAP_TARGET_44}
              variant={speedPanelOpen ? "default" : "outline"}
              onClick={onToggleSpeedPanel}
              aria-pressed={speedPanelOpen}
              aria-label={t.speedPanel}
            >
              <GaugeIcon aria-hidden="true" />
            </Button>
          </Tip>
        ) : null}
        {/* No `fullscreenSupported` gate any more: browsers without the API get
            the CSS-only pseudo-fullscreen instead of a missing button. */}
        <Tip label={isFullscreen ? t.exitFullscreen : t.fullscreen} container={menuContainer}>
          <Button
            type="button"
            size="icon"
            className={TAP_TARGET_44}
            variant="outline"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
          >
            {isFullscreen ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}
          </Button>
        </Tip>
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

/**
 * Difficulty chips with the gliding tone pill. Rendered twice: inline above the
 * transport on stacked layouts and in the desktop sidebar (lxns-style), with
 * CSS visibility switching between them — hence the per-instance pill
 * layoutId, so framer never sees two live copies of one shared layout element.
 */
export function ChartDifficultyPicker({
  levels,
  className,
  pillLayoutId,
}: {
  levels?: Record<number, string>;
  className?: string;
  pillLayoutId: string;
}) {
  const selectedDifficulty = useGameStore((s) => s.selectedDifficulty);
  const availableDifficulties = useGameStore((s) => s.availableDifficulties);

  const diffKeys = (Object.keys(availableDifficulties) as unknown as string[])
    .map(Number)
    .filter((d) => availableDifficulties[d as ChartDifficulty])
    .sort((a, b) => a - b) as ChartDifficulty[];

  if (diffKeys.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
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
                layoutId={pillLayoutId}
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
  );
}

export default ChartControls;
