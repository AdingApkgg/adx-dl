import { motion } from "@astrodx/ui/motion";
import { useRef } from "react";
import { useMotionActivity } from "./motion-preference";

const REST = { x: 0, y: 0, scale: 1, rotate: 0 };
const STILL = { duration: 0 };
const ORB_A = { x: [0, 60, -18, 0], y: [0, -34, 28, 0], scale: [1, 1.16, 1.04, 1] };
const ORB_B = { x: [0, -48, 20, 0], y: [0, 26, -32, 0], scale: [1, 1.08, 1.2, 1] };

/** One bounded scene; loops settle immediately off-screen, in background or off. */
export function MotionHeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useMotionActivity(ref);
  // Motion's transform policy can retain its mount-time OS snapshot. The live
  // React gate owns this scene; only an active scene explicitly permits loops.
  return <div ref={ref} aria-hidden="true" className="community-hero-scene" data-community-motion="ambient" data-motion-active={String(active)}>
    <motion.span className="community-hero-glow is-first" initial={false} animate={active ? ORB_A : REST}
      transition={active ? { reduceMotion: false, duration: 16, repeat: Infinity, ease: "easeInOut" } : STILL} />
    <motion.span className="community-hero-glow is-second" initial={false} animate={active ? ORB_B : REST}
      transition={active ? { reduceMotion: false, duration: 21, repeat: Infinity, ease: "easeInOut" } : STILL} />
    <div className="community-orbit-plane">
      <motion.span className="community-hero-orbit is-outer" initial={false} animate={{ rotate: active ? 360 : 0 }}
        transition={active ? { reduceMotion: false, duration: 48, repeat: Infinity, ease: "linear" } : STILL}><i /><i /></motion.span>
      <motion.span className="community-hero-orbit is-inner" initial={false} animate={{ rotate: active ? -360 : 0 }}
        transition={active ? { reduceMotion: false, duration: 36, repeat: Infinity, ease: "linear" } : STILL}><i /></motion.span>
    </div>
    <span className="community-hero-grain" />
  </div>;
}
