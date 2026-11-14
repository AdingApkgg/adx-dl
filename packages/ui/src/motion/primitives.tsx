"use client";

import * as React from "react";
import { animate, motion, useAnimationControls, useInView, useMotionValue, useMotionValueEvent, type HTMLMotionProps, type Transition } from "framer-motion";

import { getMotionPreset } from "./adapters/motion";
import { getStaggerDelay } from "./policy";
import { motionPresets } from "./presets";
import { useMotionReady, useReducedMotion } from "./provider";
import { motionTokens as t } from "./tokens";

const RevealIndexContext = React.createContext(0);
const viewport = { once: true, amount: 0.2, margin: "0px 0px -8% 0px" as const };

type RevealProps = Omit<HTMLMotionProps<"div">, "ref"> & {
  /** Legacy API uses seconds; the policy still caps the combined delay. */
  delay?: number;
  /** Defaults to readable SSR. False is reserved for decorative content. */
  ssrVisible?: boolean;
};

function RevealElement({ as = "div", delay = 0, transition, ssrVisible = true, children, ...props }: RevealProps & { as?: "div" | "li" }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewport);
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  const played = React.useRef(false);
  const cascadeDelay = React.useContext(RevealIndexContext);
  const settings = React.useRef({ delay, cascadeDelay, transition });
  settings.current = { delay, cascadeDelay, transition };

  React.useEffect(() => {
    if (reduced) {
      played.current = true;
      controls.stop();
      controls.set(motionPresets.reveal.enter.to);
      return;
    }
    if (ssrVisible || !ready || !inView || played.current) return;
    played.current = true;
    const { delay, cascadeDelay, transition } = settings.current;
    const preset = getMotionPreset("reveal", { delayMs: (cascadeDelay + delay) * 1000 });
    controls.set(motionPresets.reveal.enter.from);
    void controls.start({ ...preset.animate, transition: transition ? { ...transition, delay: Math.min(Math.max(0, cascadeDelay + delay), t.stagger.maxDelay / 1000) } : preset.transition });
  }, [controls, ready, inView, reduced, ssrVisible]);
  React.useEffect(() => () => controls.stop(), [controls]);

  const Tag = (as === "li" ? motion.li : motion.div) as typeof motion.div;
  return (
    <Tag
      {...props}
      ref={ref}
      initial={ssrVisible || reduced ? false : motionPresets.reveal.enter.from}
      animate={controls}
    >{children}</Tag>
  );
}

export function Reveal(props: RevealProps) {
  return <RevealElement {...props} />;
}

export function RevealItem(props: RevealProps & { as?: "div" | "li" }) {
  return <RevealElement {...props} />;
}

export function RevealGroup({ stagger = t.stagger.default / 1000, as = "div", children, ...props }: React.HTMLAttributes<HTMLElement> & { stagger?: number; as?: "div" | "ul" }) {
  let index = 0;
  const items = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    return <RevealIndexContext.Provider value={getStaggerDelay(index++, stagger * 1000) / 1000}>{child}</RevealIndexContext.Provider>;
  });
  return React.createElement(as, props, items);
}

type RollingNumberProps = { value: number; format?: (n: number) => string; animateOnMount?: boolean; className?: string };

/** The real value is always available to assistive technology and SSR readers. */
export function RollingNumber({ value, format = String, animateOnMount = false, className }: RollingNumberProps) {
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  const mv = useMotionValue(value);
  const [display, setDisplay] = React.useState(() => format(Math.round(value)));
  const mounted = React.useRef(false);
  const formatRef = React.useRef(format);
  formatRef.current = format;
  useMotionValueEvent(mv, "change", (v) => setDisplay(formatRef.current(Math.round(v))));

  React.useEffect(() => {
    if (!ready) return;
    const first = !mounted.current;
    mounted.current = true;
    if (reduced || (first && !animateOnMount)) {
      mv.set(value);
      setDisplay(format(Math.round(value)));
      return;
    }
    if (first) mv.set(0);
    const controls = animate(mv, value, { duration: motionPresets.number.change.durationMs / 1000, ease: t.easing.enter });
    return () => controls.stop();
  }, [value, reduced, ready, animateOnMount, mv, format]);

  return <span className={className}><span aria-hidden="true">{display}</span><span className="sr-only">{format(Math.round(value))}</span></span>;
}

type DrawnCheckProps = { animateOnMount?: boolean; size?: number; strokeWidth?: number; withCircle?: boolean; className?: string };

/** A complete mark in SSR/reduced mode; draw only once after preferences settle. */
export function DrawnCheck({ animateOnMount = true, size = 20, strokeWidth = 2.5, withCircle = true, className }: DrawnCheckProps) {
  const reduced = useReducedMotion();
  const ready = useMotionReady();
  const controls = useAnimationControls();
  const played = React.useRef(false);
  React.useEffect(() => {
    if (reduced || !animateOnMount) {
      played.current = true;
      controls.stop();
      controls.set("visible");
    } else if (ready && !played.current) {
      played.current = true;
      controls.set("hidden");
      void controls.start("visible");
    }
  }, [controls, reduced, ready, animateOnMount]);
  React.useEffect(() => () => controls.stop(), [controls]);
  const draw = { hidden: { pathLength: 0, opacity: 0 }, visible: { pathLength: 1, opacity: 1 } };
  const transition: Transition = { duration: reduced ? 0 : motionPresets.feedback.success.durationMs / 1000, ease: t.easing.enter };
  return (
    <motion.svg data-slot="drawn-check" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" initial="visible" animate={controls} className={className} aria-hidden="true">
      {withCircle ? <motion.circle cx="12" cy="12" r="10" variants={draw} transition={transition} /> : null}
      <motion.path d="M7.5 12.5l3 3 6-6.5" variants={draw} transition={transition} />
    </motion.svg>
  );
}
