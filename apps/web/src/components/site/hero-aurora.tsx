"use client";

import * as React from "react";
import { useInView, useScroll, useTransform } from "framer-motion";

import { motion, RollingNumber, useReducedMotion } from "@/components/motion";

// Two-keyframe mirrored drifts (long, offset durations) so the orbs breathe
// rather than orbit. The rest state is the identity pose the SSR HTML renders.
const ORB_REST = { x: 0, y: 0, scale: 1 };
const DRIFT_A = { x: [0, 48], y: [0, 30], scale: [1, 1.12] };
const DRIFT_B = { x: [0, -40], y: [0, -26], scale: [1, 1.08] };
const DRIFT_TRANSITION_A = {
  duration: 22,
  repeat: Infinity,
  repeatType: "mirror" as const,
  ease: "easeInOut" as const,
};
const DRIFT_TRANSITION_B = {
  duration: 26,
  repeat: Infinity,
  repeatType: "mirror" as const,
  ease: "easeInOut" as const,
};
const REST_TRANSITION = { duration: 0.9, ease: "easeOut" as const };

/**
 * The homepage hero's ambient backdrop: the two gradient orbs drift on slow
 * mirrored loops and separate at different parallax rates as the hero scrolls
 * away. Blur stays a static CSS class — only transforms animate. The infinite
 * loops are gated by hand (MotionConfig doesn't cover repeat loops or
 * style-bound motion values): they pause under reduced motion, while the hero
 * is off-screen, and while the tab is hidden.
 */
export function HeroAurora() {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref);
  const [tabVisible, setTabVisible] = React.useState(true);

  React.useEffect(() => {
    const update = () => setTabVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const active = Boolean(!reduced && inView && tabVisible);

  const { scrollY } = useScroll();
  const parallaxSlow = useTransform(scrollY, [0, 640], [0, 96], { clamp: true });
  const parallaxFast = useTransform(scrollY, [0, 640], [0, -72], { clamp: true });

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <motion.div
        style={reduced ? undefined : { y: parallaxSlow }}
        className="absolute -top-24 -left-24 size-[420px]"
      >
        <motion.div
          animate={active ? DRIFT_A : ORB_REST}
          transition={active ? DRIFT_TRANSITION_A : REST_TRANSITION}
          className="size-full rounded-full bg-primary/25 blur-3xl"
        />
      </motion.div>
      <motion.div
        style={reduced ? undefined : { y: parallaxFast }}
        className="absolute right-0 -bottom-32 size-[380px]"
      >
        <motion.div
          animate={active ? DRIFT_B : ORB_REST}
          transition={active ? DRIFT_TRANSITION_B : REST_TRANSITION}
          className="size-full rounded-full bg-fuchsia-500/20 blur-3xl"
        />
      </motion.div>
    </div>
  );
}

const formatGrouped = (n: number) => n.toLocaleString();

/**
 * Hero stat count-up. Lives in this client island (not page-views) because
 * RollingNumber's `format` is a function, and functions can't cross the
 * server→client component boundary. SSR HTML always shows the real value.
 */
export function HeroStatNumber({ value }: { value: number }) {
  return <RollingNumber value={value} animateOnMount format={formatGrouped} />;
}
