import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MirrorMode, JudgmentLineDesign } from "@lxns-network/maimai-chart-engine";

export type FullscreenQuality = "smooth" | "balanced" | "high";

/** Whole-surface view rotation (deg) — for tablets laid flat where the player
 *  sits on another side. The HUD is engine-drawn inside the canvas, so it
 *  correctly rotates along with the playfield. */
export type ViewRotation = 0 | 90 | 180 | 270;

export const FULLSCREEN_QUALITY_MP: Record<FullscreenQuality, number> = {
  smooth: 2_000_000,
  balanced: 2_500_000,
  high: 3_500_000,
};

/**
 * Playback speed lives here rather than in the (non-persisted) game store: it
 * sits in the same card as hi-speed, and having one of the two survive a reload
 * while the other silently snapped back to 1.0x read as a bug. The game store
 * is reset on every source change by design, which is exactly what kept eating
 * it. 2.0 is the ceiling on the render side (`MainRenderer.setPlaybackSpeed`)
 * and the audio side (`AudioBufferSourceNode.playbackRate`) alike.
 */
export const MIN_PLAYBACK_SPEED = 0.1;
export const MAX_PLAYBACK_SPEED = 2;

export interface GameSettingsState {
  hiSpeed: number;
  playbackSpeed: number;
  alwaysKeepHiSpeed: boolean;
  slideRotation: boolean;
  mirrorMode: MirrorMode;
  judgmentLineDesign: JudgmentLineDesign;
  pinkSlideStart: boolean;
  highlightExNotes: boolean;
  normalColorBreakSlide: boolean;
  showFireworks: boolean;
  showHitEffect: boolean;
  fpsLimit: number;
  soundEnabled: boolean;
  soundVolume: number;
  soundOffset: number;
  musicVolume: number;
  musicOffset: number;
  fullscreenQuality: FullscreenQuality;
  showVideo: boolean;
  /** Engine-drawn HUD counters (combo / BREAK totals) painted into the canvas. */
  showNoteTotal: boolean;
  showBreakCount: boolean;
  viewRotation: ViewRotation;
  /** Chart-media mirror used for the preview background PV (download-source id). */
  videoSourceId: string;
}

export interface GameSettingsActions {
  setHiSpeed: (speed: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setAlwaysKeepHiSpeed: (enabled: boolean) => void;
  setSlideRotation: (enabled: boolean) => void;
  setMirrorMode: (mode: MirrorMode) => void;
  setJudgmentLineDesign: (design: JudgmentLineDesign) => void;
  setPinkSlideStart: (enabled: boolean) => void;
  setHighlightExNotes: (enabled: boolean) => void;
  setNormalColorBreakSlide: (enabled: boolean) => void;
  setShowFireworks: (enabled: boolean) => void;
  setShowHitEffect: (enabled: boolean) => void;
  setFpsLimit: (limit: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;
  setSoundOffset: (offset: number) => void;
  setMusicVolume: (volume: number) => void;
  setMusicOffset: (offset: number) => void;
  setFullscreenQuality: (quality: FullscreenQuality) => void;
  setShowVideo: (enabled: boolean) => void;
  setShowNoteTotal: (enabled: boolean) => void;
  setShowBreakCount: (enabled: boolean) => void;
  cycleViewRotation: () => void;
  setVideoSourceId: (id: string) => void;
}

export type GameSettingsStore = GameSettingsState & GameSettingsActions;

const SETTINGS_STORE_VERSION = 1;

const initialState: GameSettingsState = {
  hiSpeed: 6,
  playbackSpeed: 1,
  alwaysKeepHiSpeed: false,
  slideRotation: true,
  mirrorMode: "none",
  judgmentLineDesign: "simple",
  pinkSlideStart: false,
  highlightExNotes: false,
  normalColorBreakSlide: false,
  showFireworks: true,
  showHitEffect: true,
  fpsLimit: 0,
  soundEnabled: false,
  soundVolume: 0.5,
  soundOffset: 0,
  musicVolume: 0.8,
  musicOffset: 0,
  fullscreenQuality: "balanced",
  showVideo: false,
  showNoteTotal: true,
  showBreakCount: true,
  viewRotation: 0,
  videoSourceId: "r2",
};

export const useGameSettingsStore = create<GameSettingsStore>()(
  persist(
    (set) => ({
      ...initialState,
      setHiSpeed: (speed: number) => set({ hiSpeed: Math.max(3, Math.min(9, speed)) }),
      setPlaybackSpeed: (speed: number) =>
        set({
          playbackSpeed: Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, speed)),
        }),
      setAlwaysKeepHiSpeed: (enabled: boolean) => set({ alwaysKeepHiSpeed: enabled }),
      setSlideRotation: (enabled: boolean) => set({ slideRotation: enabled }),
      setMirrorMode: (mode: MirrorMode) => set({ mirrorMode: mode }),
      setJudgmentLineDesign: (design: JudgmentLineDesign) => set({ judgmentLineDesign: design }),
      setPinkSlideStart: (enabled: boolean) => set({ pinkSlideStart: enabled }),
      setHighlightExNotes: (enabled: boolean) => set({ highlightExNotes: enabled }),
      setNormalColorBreakSlide: (enabled: boolean) => set({ normalColorBreakSlide: enabled }),
      setShowFireworks: (enabled: boolean) => set({ showFireworks: enabled }),
      setShowHitEffect: (enabled: boolean) => set({ showHitEffect: enabled }),
      setFpsLimit: (limit: number) => set({ fpsLimit: limit }),
      setSoundEnabled: (enabled: boolean) => set({ soundEnabled: enabled }),
      setSoundVolume: (volume: number) => set({ soundVolume: Math.max(0, Math.min(1, volume)) }),
      setSoundOffset: (offset: number) => set({ soundOffset: offset }),
      setMusicVolume: (volume: number) => set({ musicVolume: Math.max(0, Math.min(1, volume)) }),
      setMusicOffset: (offset: number) => set({ musicOffset: offset }),
      setFullscreenQuality: (quality: FullscreenQuality) => set({ fullscreenQuality: quality }),
      setShowVideo: (enabled: boolean) => set({ showVideo: enabled }),
      setShowNoteTotal: (enabled: boolean) => set({ showNoteTotal: enabled }),
      setShowBreakCount: (enabled: boolean) => set({ showBreakCount: enabled }),
      cycleViewRotation: () =>
        set((state) => ({
          viewRotation: ((state.viewRotation + 90) % 360) as ViewRotation,
        })),
      setVideoSourceId: (id: string) => set({ videoSourceId: id }),
    }),
    {
      name: "astrodx_chart_preview_settings",
      version: SETTINGS_STORE_VERSION,
      migrate: (persistedState) => ({
        ...initialState,
        ...(persistedState as Partial<GameSettingsState>),
      }),
      partialize: (state) => ({
        hiSpeed: state.hiSpeed,
        playbackSpeed: state.playbackSpeed,
        alwaysKeepHiSpeed: state.alwaysKeepHiSpeed,
        slideRotation: state.slideRotation,
        mirrorMode: state.mirrorMode,
        judgmentLineDesign: state.judgmentLineDesign,
        pinkSlideStart: state.pinkSlideStart,
        highlightExNotes: state.highlightExNotes,
        normalColorBreakSlide: state.normalColorBreakSlide,
        showFireworks: state.showFireworks,
        showHitEffect: state.showHitEffect,
        fpsLimit: state.fpsLimit,
        soundEnabled: state.soundEnabled,
        soundVolume: state.soundVolume,
        soundOffset: state.soundOffset,
        musicVolume: state.musicVolume,
        musicOffset: state.musicOffset,
        fullscreenQuality: state.fullscreenQuality,
        showVideo: state.showVideo,
        showNoteTotal: state.showNoteTotal,
        showBreakCount: state.showBreakCount,
        viewRotation: state.viewRotation,
        videoSourceId: state.videoSourceId,
      }),
    },
  ),
);
