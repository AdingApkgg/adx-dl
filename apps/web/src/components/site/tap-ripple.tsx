"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";

// A fixed pool of recycled nodes keeps the cost constant no matter how fast
// the user taps (round-robin, like maimai's own touch feedback rings).
const POOL_SIZE = 4;

/**
 * maimai-style pointer feedback: an expanding primary-colored ring at every
 * tap point. Purely decorative — the layer is pointer-events-none and
 * aria-hidden, and does nothing under reduced motion. Animated via the Web
 * Animations API (transform/opacity only) so no React re-render per tap.
 */
export function TapRipple() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const nextIndex = React.useRef(0);
  const prefersReducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (prefersReducedMotion) return;
    const container = containerRef.current;
    if (!container || typeof container.children[0]?.animate !== "function") return;
    const nodes = Array.from(container.children) as HTMLElement[];

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Presses on the scrollbar gutters sit outside the layout viewport.
      const root = document.documentElement;
      if (event.clientX >= root.clientWidth || event.clientY >= root.clientHeight) return;
      const node = nodes[nextIndex.current];
      nextIndex.current = (nextIndex.current + 1) % nodes.length;
      node.style.left = `${event.clientX}px`;
      node.style.top = `${event.clientY}px`;
      node.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0.85 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
        ],
        { duration: 500, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [prefersReducedMotion]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[80]"
    >
      {Array.from({ length: POOL_SIZE }, (_, index) => (
        <span
          key={index}
          // Base opacity 0: each ring is only visible for the duration of its
          // WAAPI animation, then falls back to invisible.
          className="absolute size-20 rounded-full border-2 border-primary opacity-0"
          style={{ left: -100, top: -100 }}
        />
      ))}
    </div>
  );
}
