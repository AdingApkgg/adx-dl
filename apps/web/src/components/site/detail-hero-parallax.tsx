"use client";

import * as React from "react";
import { useScroll, useTransform } from "framer-motion";

import { EASE_OUT, motion, revealTransition, springSoft, useReducedMotion } from "@astrodx/ui/motion";

/**
 * Parallax shell for the chart detail hero's blurred cover backdrop: as the
 * hero scrolls out, the backdrop trails the scroll (translateY, slower rate)
 * and dims slightly. Identity transform at scroll 0, so the SSR markup renders
 * the same resting composition. The inner box bleeds vertically so the slower
 * layer never exposes the hero's background while it lags.
 */
export function DetailHeroBackdrop({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 56]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.55]);

  return (
    <div ref={ref} aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        // Style-bound motion values bypass MotionConfig, so gate by hand.
        style={reduced ? undefined : { y, opacity }}
        className="absolute inset-x-0 -inset-y-16"
      >
        {children}
      </motion.div>
    </div>
  );
}

/** Full artwork with a stable frame and shared navigation transition. */
export function DetailHeroCover({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div
        data-cover-artwork
        className="relative aspect-square overflow-hidden rounded border border-border/60"
        style={{ viewTransitionName: "chart-cover" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Related-charts rail card: a transform-only settle on scroll-in (the cards are
 * SEO-critical links, so no opacity is ever serialized) plus a slight lift on
 * hover; the chevron inside the link follows via CSS group-hover.
 */
export function RelatedChartRow({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <motion.li
      initial={{ y: 10 }}
      whileInView={{
        y: 0,
        transition: { ...revealTransition, duration: 0.4, delay: Math.min(index * 0.05, 0.35) },
      }}
      viewport={{ once: true, amount: 0.4 }}
      whileHover={{ y: -3, transition: springSoft }}
    >
      {children}
    </motion.li>
  );
}
