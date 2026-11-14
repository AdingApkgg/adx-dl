"use client";

import { useEffect } from "react";
import { animate, useMotionValue } from "framer-motion";
import { getProgressTransition } from "./adapters/motion";
import { useMotionReady, useReducedMotion } from "./provider";

/** Bounded UI interpolation, independent of the business state or clock. */
export function useMotionProgress(value: number) {
  const target = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const progress = useMotionValue(target);
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  useEffect(() => {
    if (reduced || !ready) {
      progress.jump(target);
      return;
    }
    const animation = animate(progress, target, getProgressTransition());
    return () => animation.stop();
  }, [target, progress, reduced, ready]);
  return progress;
}
