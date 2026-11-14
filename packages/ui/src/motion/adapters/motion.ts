import type { Transition } from "framer-motion";
import { motionPresets } from "../presets";
import { motionTokens, type MotionScheme, type MotionTempo, type SpringToken } from "../tokens";

export function toMotionSpring({ stiffness, dampingRatio, mass }: SpringToken) {
  return { type: "spring" as const, stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness * mass), mass };
}

export function getMotionTransition(scheme: MotionScheme, tempo: MotionTempo, reduced = false): Transition {
  return reduced ? { duration: 0, delay: 0 } : toMotionSpring(motionTokens.schemes[scheme].spatial[tempo]);
}

type EntrancePattern = "reveal" | "popup" | "backdrop" | "dialog" | "sheet" | "disclosure";
export function getMotionPreset(pattern: EntrancePattern, { reduced = false, delayMs = 0 }: { reduced?: boolean; delayMs?: number } = {}) {
  const preset = motionPresets[pattern].enter;
  const delay = Math.max(0, Math.min(delayMs, motionTokens.stagger.maxDelay)) / 1000;
  const exitState = pattern === "disclosure" ? motionPresets.disclosure.exit : { opacity: 0 };
  return {
    initial: reduced ? false as const : preset.from,
    animate: preset.to,
    exit: { ...exitState, transition: { duration: reduced ? 0 : motionTokens.duration.fast / 1000, delay: 0, ease: motionTokens.easing.exit } },
    transition: reduced ? { duration: 0, delay: 0 } as Transition : {
      default: { ...toMotionSpring(motionTokens.schemes[preset.scheme].spatial[preset.tempo]), delay },
      opacity: { ...toMotionSpring(motionTokens.schemes[preset.scheme].effects[pattern === "backdrop" ? "default" : "fast"]), delay },
    } as Transition,
  };
}

/** Use semantic intent at call sites; opacity never inherits a spatial bounce. */
export function getSemanticTransition(pattern: "press" | "hover" | "selection" | "layout", reduced = false): Transition {
  if (reduced) return { duration: 0, delay: 0 };
  const preset = pattern === "selection" || pattern === "layout" ? motionPresets[pattern].move : motionPresets[pattern];
  return {
    default: toMotionSpring(motionTokens.schemes[preset.scheme].spatial[preset.tempo]),
    opacity: getEffectsTransition("fast"),
  };
}

export function getEffectsTransition(tempo: MotionTempo = "fast", reduced = false): Transition {
  return reduced ? { duration: 0, delay: 0 } : toMotionSpring(motionTokens.schemes.expressive.effects[tempo]);
}

export function getProgressTransition(reduced = false) {
  return { type: "tween" as const, duration: reduced ? 0 : motionPresets.progress.change.durationMs / 1000, delay: 0, ease: "linear" as const };
}

export function getPressTarget(reduced = false) {
  return { ...(reduced ? motionPresets.press.end : motionPresets.press.start), transition: getSemanticTransition("press", reduced) };
}
