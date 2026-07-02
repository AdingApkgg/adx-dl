"use client";

import * as React from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type HTMLMotionProps,
  type Transition,
  type Variants,
} from "framer-motion";

export { AnimatePresence, motion };

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

/**
 * Opts every descendant animation into the OS "reduce motion" preference, so we
 * don't have to gate each component by hand. With `reducedMotion="user"`,
 * framer-motion drops transform/layout animations (keeping only opacity) when
 * the user asks for reduced motion — mirroring the `@view-transition` guard in
 * globals.css.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// --- Reveal: fade + rise as it scrolls into view --------------------------

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

// Trigger a touch before the element is fully on screen, and only once, so the
// reveal feels like it greets you rather than firing after you've already read
// past it. Page-critical content (the catalog grid) renders visible immediately
// via `initial={false}` and never depends on this, so a reveal only ever
// decorates headings and secondary sections.
const REVEAL_VIEWPORT = { once: true, amount: 0.2, margin: "0px 0px -8% 0px" };

type RevealProps = Omit<HTMLMotionProps<"div">, "ref"> & {
  /** Delay before the reveal starts (seconds) — handy for manual sequencing. */
  delay?: number;
  /**
   * Content-bearing sections must be readable before hydration: `ssrVisible`
   * skips the hidden initial state so no `opacity:0` is serialized into the
   * static HTML (same idea as the catalog grid's `initial={false}`), trading
   * the rise-in for content that never depends on JS.
   */
  ssrVisible?: boolean;
};

/**
 * Block-level scroll reveal (fade + rise). Safe to drop into a server component —
 * it only takes serializable props and renders its children inside a client
 * `motion.div`. The OS "reduce motion" preference is honored globally by
 * `MotionProvider` (the rise is dropped, a gentle fade remains).
 */
export function Reveal({ delay = 0, transition, ssrVisible = false, children, ...props }: RevealProps) {
  return (
    <motion.div
      initial={ssrVisible ? false : "hidden"}
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      variants={revealVariants}
      transition={{ ...revealTransition, delay, ...transition }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// --- Stagger group: reveal a set of children one after another -------------
//
// Rather than rely on framer's parent→child variant propagation (which is
// fragile once a non-motion wrapper such as `MetricCard` sits between the group
// and its items), each `RevealItem` reveals itself on scroll-in and the group
// hands it a cascade offset via context. Items therefore stagger no matter how
// they're nested.

const RevealIndexContext = React.createContext(0);

type RevealGroupProps = React.ComponentProps<"div"> & {
  /** Seconds between consecutive item reveals. */
  stagger?: number;
};

/** Container whose `RevealItem` descendants cascade in on mount. */
export function RevealGroup({ stagger = 0.06, children, ...props }: RevealGroupProps) {
  let index = 0;
  const indexed = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    return (
      <RevealIndexContext.Provider value={index++ * stagger}>
        {child}
      </RevealIndexContext.Provider>
    );
  });
  return <div {...props}>{indexed}</div>;
}

type RevealItemProps = Omit<HTMLMotionProps<"div">, "ref"> & {
  /** Extra delay (seconds) on top of any cascade position from `RevealGroup`. */
  delay?: number;
  /** See `Reveal`: render visible in the SSR HTML, skipping the hidden initial state. */
  ssrVisible?: boolean;
};

/** A self-contained staggered child — rises + fades in as it scrolls into view. */
export function RevealItem({ delay = 0, transition, ssrVisible = false, children, ...props }: RevealItemProps) {
  const cascadeDelay = React.useContext(RevealIndexContext);
  return (
    <motion.div
      initial={ssrVisible ? false : "hidden"}
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      variants={revealVariants}
      transition={{ ...revealTransition, delay: cascadeDelay + delay, ...transition }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
