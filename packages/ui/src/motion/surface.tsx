"use client";

import * as React from "react";
import { motion, useAnimationControls, usePresence, type HTMLMotionProps } from "framer-motion";
import { getMotionPreset } from "./adapters/motion";
import { useMotionReady, useReducedMotion } from "./provider";

type SurfaceTag = "div" | "span" | "ul" | "li" | "p" | "button";
type Pattern = Parameters<typeof getMotionPreset>[0];
export type MotionSurfaceProps<T extends SurfaceTag = "div"> = Omit<HTMLMotionProps<T>, "animate" | "exit"> & { as?: T; pattern: Pattern };

/** Own the animation and presence lifecycle so policy changes can cancel both
 * enter and exit. Changing only transition doesn't restart unchanged targets. */
export function MotionSurface<T extends SurfaceTag = "div">({ as, pattern, initial, transition, style, ...props }: MotionSurfaceProps<T>) {
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  const controls = useAnimationControls();
  const [isPresent, safeToRemove] = usePresence();
  const settings = React.useRef({ transition });
  settings.current = { transition };

  React.useLayoutEffect(() => {
    const preset = getMotionPreset(pattern, { reduced });
    const { transition: exitTransition, ...exitState } = preset.exit;
    controls.stop();
    if (reduced || !ready) {
      controls.set({ scale: 1, x: 0, y: 0, ...(isPresent ? preset.animate : exitState) });
      if (!isPresent) safeToRemove?.();
      return;
    }
    let current = true;
    const target = isPresent
      ? { ...preset.animate, transition: settings.current.transition ?? preset.transition }
      : { ...exitState, transition: exitTransition };
    void controls.start(target).then(() => {
      if (current && !isPresent) safeToRemove?.();
    });
    return () => { current = false; controls.stop(); };
  }, [controls, isPresent, pattern, ready, reduced, safeToRemove]);

  // Tags have different DOM event types but the same Motion lifecycle. Preserve
  // native attributes/ref for the selected tag rather than introducing a wrapper.
  const Tag = motion[as ?? "div"] as unknown as React.ComponentType<HTMLMotionProps<T>>;
  const preset = getMotionPreset(pattern, { reduced });
  const motionProps = {
    ...props,
    initial: reduced || !ready ? false : initial ?? preset.initial,
    animate: controls,
    transition: reduced ? { duration: 0, delay: 0 } : transition ?? preset.transition,
    inert: !isPresent || props.inert,
    "aria-hidden": !isPresent ? true : props["aria-hidden"],
    style: { ...style, ...(!isPresent ? { pointerEvents: "none" } : {}) },
  } as unknown as HTMLMotionProps<T>;
  return React.createElement(Tag, motionProps);
}
