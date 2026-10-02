// Shared by MotionProvider and the no-flash boot script (../theme/boot-script.ts),
// so the two cannot drift apart. No "use client" here: web's root layout (a
// server component) builds the boot script from these values.

/** localStorage key for the user's explicit site-level motion preference. */
export const MOTION_STORAGE_KEY = "adx-reduce-motion";
export const MOTION_MODES = ["system", "on", "off"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];
