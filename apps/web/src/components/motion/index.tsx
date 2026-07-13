"use client";

import * as React from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
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

type RevealGroupProps = React.HTMLAttributes<HTMLElement> & {
  /** Seconds between consecutive item reveals. */
  stagger?: number;
  /** Wrapper element — set to "ul" for a semantic list (pair with `RevealItem as="li"`). */
  as?: "div" | "ul";
};

/** Container whose `RevealItem` descendants cascade in on mount. */
export function RevealGroup({ stagger = 0.06, as = "div", children, ...props }: RevealGroupProps) {
  let index = 0;
  const indexed = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    return (
      <RevealIndexContext.Provider value={index++ * stagger}>
        {child}
      </RevealIndexContext.Provider>
    );
  });
  // createElement avoids the JSX union-tag typing pitfall while still rendering
  // a plain (non-motion) wrapper — only the RevealItem children animate.
  return React.createElement(as, props, indexed);
}

type RevealItemProps = Omit<HTMLMotionProps<"div">, "ref"> & {
  /** Extra delay (seconds) on top of any cascade position from `RevealGroup`. */
  delay?: number;
  /** See `Reveal`: render visible in the SSR HTML, skipping the hidden initial state. */
  ssrVisible?: boolean;
  /** Element — set to "li" for a semantic list item (pair with `RevealGroup as="ul"`). */
  as?: "div" | "li";
};

// --- Overlay variants: shared enter/exit shapes for dialogs and sheets -----
//
// One vocabulary for every modal surface (media dialog, comments, fullscreen
// preview, confirm layers) so they all breathe the same way. Pair with
// `AnimatePresence` and `initial="hidden" animate="visible" exit="hidden"`.

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

// --- RollingNumber: spring/tween a numeric readout between values ----------

type RollingNumberProps = {
  value: number;
  /** Render the (rounded) in-flight number — e.g. toLocaleString. */
  format?: (n: number) => string;
  /**
   * Also count up on first mount (0 → value). The SSR/static HTML always
   * contains the real final value — the count-up is a post-hydration effect —
   * so crawlers and no-JS readers never see a 0.
   */
  animateOnMount?: boolean;
  className?: string;
};

/**
 * Animated numeric text. The accessible text is always the final value (the
 * animated digits are aria-hidden), so screen readers and aria-live regions
 * hear one announcement, not sixty frames of counting.
 */
export function RollingNumber({ value, format = String, animateOnMount = false, className }: RollingNumberProps) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const [display, setDisplay] = React.useState(() => format(Math.round(value)));
  const mounted = React.useRef(false);
  const formatRef = React.useRef(format);
  formatRef.current = format;

  useMotionValueEvent(mv, "change", (v) => setDisplay(formatRef.current(Math.round(v))));

  React.useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (reduced || (first && !animateOnMount)) {
      mv.set(value);
      setDisplay(formatRef.current(Math.round(value)));
      return;
    }
    if (first) mv.set(0);
    const controls = animate(mv, value, { duration: 0.8, ease: EASE_OUT });
    return () => controls.stop();
  }, [value, reduced, animateOnMount, mv]);

  return (
    <span className={className}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{format(Math.round(value))}</span>
    </span>
  );
}

// --- DrawnCheck: an SVG checkmark that draws itself in ---------------------

type DrawnCheckProps = {
  size?: number;
  strokeWidth?: number;
  /** Draw an enclosing circle before the check stroke. */
  withCircle?: boolean;
  className?: string;
};

/**
 * Success mark whose stroke draws in via `pathLength` — the payoff moment for
 * downloads/archives. Under reduced motion the paths render complete (framer
 * keeps only the opacity fade).
 */
export function DrawnCheck({ size = 20, strokeWidth = 2.5, withCircle = true, className }: DrawnCheckProps) {
  const draw: Variants = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: { pathLength: 1, opacity: 1 },
  };
  return (
    <motion.svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial="hidden"
      animate="visible"
      className={className}
      aria-hidden="true"
    >
      {withCircle ? (
        <motion.circle cx="12" cy="12" r="10" variants={draw} transition={{ duration: 0.4, ease: EASE_OUT }} />
      ) : null}
      <motion.path
        d="M7.5 12.5l3 3 6-6.5"
        variants={draw}
        transition={{ duration: 0.35, ease: EASE_OUT, delay: withCircle ? 0.18 : 0 }}
      />
    </motion.svg>
  );
}

/** A self-contained staggered child — rises + fades in as it scrolls into view. */
export function RevealItem({ delay = 0, transition, ssrVisible = false, as = "div", children, ...props }: RevealItemProps) {
  const cascadeDelay = React.useContext(RevealIndexContext);
  // motion.li at runtime when as="li"; cast to the div motion type so the shared
  // animation props (which are identical across elements) type-check as one tag.
  const MotionTag = (as === "li" ? motion.li : motion.div) as typeof motion.div;
  return (
    <MotionTag
      initial={ssrVisible ? false : "hidden"}
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      variants={revealVariants}
      transition={{ ...revealTransition, delay: cascadeDelay + delay, ...transition }}
      {...props}
    >
      {children}
    </MotionTag>
  );
}
