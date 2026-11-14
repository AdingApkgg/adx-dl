import { motionTokens as t, type MotionScheme, type MotionTempo } from "./tokens";

type MotionState = { opacity?: number; x?: number; y?: number; scale?: number; height?: number | "auto" };
type Entrance = { scheme: MotionScheme; tempo: MotionTempo; from: MotionState; to: MotionState };
const entrance = (scheme: MotionScheme, tempo: MotionTempo, from: MotionState, to: MotionState): Entrance => ({ scheme, tempo, from, to });

/** Platform-neutral semantic states. Adapters own engine-specific transitions. */
export const motionPresets = {
  press: { start: { scale: t.scale.press }, end: { scale: 1 }, scheme: "standard", tempo: "fast" },
  hover: { start: { y: -t.distance.xs }, end: { y: 0 }, scheme: "standard", tempo: "fast" },
  selection: { move: { scheme: "standard", tempo: "fast" } },
  reveal: { enter: entrance("expressive", "default", { opacity: 0, y: t.distance.md }, { opacity: 1, y: 0 }) },
  popup: { enter: entrance("standard", "fast", { opacity: 0, y: t.distance.xs }, { opacity: 1, y: 0 }), exit: { opacity: 0 } },
  disclosure: { enter: entrance("standard", "fast", { height: 0, opacity: 0 }, { height: "auto", opacity: 1 }), exit: { height: 0, opacity: 0 } },
  backdrop: { enter: entrance("expressive", "default", { opacity: 0 }, { opacity: 1 }), exit: { opacity: 0 } },
  dialog: { enter: entrance("expressive", "default", { opacity: 0, y: 12, scale: t.scale.dialogStart }, { opacity: 1, y: 0, scale: 1 }), exit: { opacity: 0 } },
  sheet: { enter: entrance("expressive", "default", { opacity: 0, y: t.distance.lg }, { opacity: 1, y: 0 }), exit: { opacity: 0 } },
  layout: { move: { scheme: "expressive", tempo: "default" } },
  page: { enter: { durationMs: t.duration.slow, distancePx: 12 }, exit: { durationMs: 180, distancePx: -t.distance.sm } },
  shared: { move: { durationMs: 450 } },
  number: { change: { durationMs: t.duration.default } },
  progress: { change: { durationMs: t.duration.fast } },
  feedback: { success: { durationMs: t.duration.slow }, attention: { durationMs: t.duration.slow, x: [0, -2, 2, 0] } },
  ambient: { loop: {
    requiresVisible: true, requiresForeground: true,
    discDurationMs: 10_000, equalizerDurationMs: 900,
    sweepDurationMs: 1400, sweepDelayMs: 400, placeholderCycleMs: 3200,
    marqueeMinDurationMs: 6000, marqueeSpeedPxPerSecond: 28,
  } },
} as const;
