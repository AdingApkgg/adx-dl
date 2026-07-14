"use client";

import * as React from "react";
import { useScroll, useSpring } from "framer-motion";

import { motion, useReducedMotion } from "@/components/motion";

/**
 * Decorative scroll-progress spine for the version timeline/grid: a slim track
 * hugging the content's left gutter whose fill springs along with how far the
 * wrapped block has scrolled through the viewport. Purely additive — the
 * children keep their own layout — and hidden on small screens, where the
 * gutter it sits in doesn't exist. Style-bound motion values bypass
 * MotionConfig's reduced-motion handling, so under reduced motion the spine is
 * rendered fully filled instead.
 */
export function VersionScrollSpine({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    // Start filling as the block enters the lower viewport; finish slightly
    // before its end leaves, so the spine completes while still visible.
    offset: ["start 0.85", "end 0.7"],
  });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.5 });

  return (
    <div ref={ref} className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1 bottom-1 -left-3 hidden w-0.5 rounded-full bg-border/60 md:block"
      >
        <motion.div
          className="absolute inset-0 origin-top rounded-full bg-primary/60"
          style={{ scaleY: reduced ? 1 : fill }}
        />
      </div>
      {children}
    </div>
  );
}
