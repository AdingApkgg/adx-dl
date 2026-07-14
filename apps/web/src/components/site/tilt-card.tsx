"use client";

import * as React from "react";
import {
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";

import { motion, useReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";

const MAX_TILT = 5; // degrees

// Mirrors springSoft (components/motion) — useSpring wants bare spring options,
// not a full Transition object.
const TILT_SPRING = { stiffness: 320, damping: 30, mass: 0.7 };

type TiltCardProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Pointer-tilt wrapper: the card lifts toward the cursor (±5° rotateX/rotateY
 * on springs) with a cursor-tracking radial sheen that fades in on hover. At
 * rest every value is identity, so the prerendered HTML carries no transform —
 * the host's existing CSS hover styles remain the fallback base. Disabled
 * under reduced motion and on non-hover pointers (touch).
 */
export function TiltCard({ children, className }: TiltCardProps) {
  const reduced = useReducedMotion();
  const [hoverCapable, setHoverCapable] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(hover: hover)");
    const update = () => setHoverCapable(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const enabled = hoverCapable && !reduced;

  // Normalized pointer position inside the card (0..1), resting at center.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [-MAX_TILT, MAX_TILT]), TILT_SPRING);
  const rotateY = useSpring(useTransform(px, [0, 1], [MAX_TILT, -MAX_TILT]), TILT_SPRING);

  const sheenX = useTransform(px, (v) => v * 100);
  const sheenY = useTransform(py, (v) => v * 100);
  const sheen = useMotionTemplate`radial-gradient(240px circle at ${sheenX}% ${sheenY}%, rgb(255 255 255 / 0.16), transparent 65%)`;

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
  };

  const handleEnter = () => {
    if (enabled) setHovered(true);
  };

  const handleLeave = () => {
    px.set(0.5);
    py.set(0.5);
    setHovered(false);
  };

  return (
    <div style={{ perspective: 900 }}>
      <motion.div
        style={{ rotateX, rotateY }}
        onPointerMove={handleMove}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        className={cn("relative", className)}
      >
        {children}
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ opacity: enabled && hovered ? 1 : 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          style={{ background: sheen }}
          className="pointer-events-none absolute inset-0"
        />
      </motion.div>
    </div>
  );
}
