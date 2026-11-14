import type { Transition, Variants } from "framer-motion";

/** Legacy exports keep their original values during gradual migration. */
// One easing curve shared across the whole site so every reveal, hover, and
// reflow has the same "personality" (a soft ease-out).
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const revealTransition: Transition = { duration: 0.5, ease: EASE_OUT };

// A snappy spring used for hovers / layout reflow where a duration feels stiff.
export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.7,
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** Centered dialog: soft scale + rise. */
export const dialogVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

/** Full-height sheet/overlay: rises like a cover. */
export const sheetVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

