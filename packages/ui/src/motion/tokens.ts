/** AstroDX Web calibration values, inspired by M3's taxonomy, not official M3 tokens. */
export type MotionScheme = "expressive" | "standard";
export type MotionTempo = "fast" | "default" | "slow";
export type SpringToken = { stiffness: number; dampingRatio: number; mass: number };

const spring = (stiffness: number, dampingRatio: number): SpringToken => ({ stiffness, dampingRatio, mass: 1 });
const effects = {
  fast: spring(1800, 1), default: spring(1000, 1), slow: spring(600, 1),
};

export const motionTokens = {
  schemes: {
    expressive: { spatial: { fast: spring(500, 0.78), default: spring(380, 0.82), slow: spring(240, 0.86) }, effects },
    standard: { spatial: { fast: spring(1200, 1), default: spring(420, 1), slow: spring(280, 1) }, effects },
  },
  duration: { fast: 120, default: 200, slow: 320 },
  distance: { xs: 4, sm: 8, md: 16, lg: 24 },
  scale: { press: 0.97, dialogStart: 0.96 },
  stagger: { tight: 30, default: 50, maxDelay: 200, maxItems: 6 },
  easing: {
    enter: [0.22, 1, 0.36, 1], standard: [0.4, 0, 0.2, 1], exit: [0.4, 0, 1, 1],
  },
} as const;
