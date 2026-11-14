"use client";

export { AnimatePresence, motion } from "framer-motion";
export { MOTION_MODES, type MotionMode } from "./constants";
export { motionConfigPreference, parseMotionMode, resolveReducedMotion, getStaggerDelay } from "./policy";
export { motionTokens, type MotionScheme, type MotionTempo } from "./tokens";
export { motionPresets } from "./presets";
export { getMotionPreset, getMotionTransition, getSemanticTransition, getPressTarget, getEffectsTransition, getProgressTransition, toMotionSpring } from "./adapters/motion";
export { MotionProvider, useMotionPreference, useReducedMotion, useMotionReady, useMotionActivity } from "./provider";
export { EASE_OUT, revealTransition, springSoft, backdropVariants, dialogVariants, sheetVariants } from "./legacy";
export { MotionSurface, type MotionSurfaceProps } from "./surface";
export { useMotionProgress } from "./progress";
export { Reveal, RevealGroup, RevealItem, RollingNumber, DrawnCheck } from "./primitives";
