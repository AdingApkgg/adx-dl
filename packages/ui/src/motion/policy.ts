import { MOTION_MODES, type MotionMode } from "./constants";
import { motionTokens } from "./tokens";

export function parseMotionMode(value: string | null | undefined): MotionMode {
  if (value === "1") return "off";
  if (value === "0") return "system";
  return MOTION_MODES.includes(value as MotionMode) ? value as MotionMode : "system";
}

/** Also serialized into the no-flash boot script: keep this function self-contained. */
export function resolveReducedMotion(mode: MotionMode, osReduced: boolean, forceReducedMotion = false): boolean {
  return forceReducedMotion || mode === "off" || (mode === "system" && osReduced);
}

export function motionConfigPreference(mode: MotionMode): "user" | "never" | "always" {
  return mode === "on" ? "never" : mode === "off" ? "always" : "user";
}

export function getStaggerDelay(index: number, stepMs: number = motionTokens.stagger.default): number {
  if (index < 0 || index >= motionTokens.stagger.maxItems || !Number.isFinite(stepMs)) return 0;
  return Math.min(Math.max(0, index * stepMs), motionTokens.stagger.maxDelay);
}
