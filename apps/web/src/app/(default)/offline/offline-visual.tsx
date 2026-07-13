"use client";

import { useReducedMotion } from "framer-motion";
import { WifiOffIcon } from "lucide-react";

import { motion } from "@/components/motion";

/**
 * WifiOff icon ringed by two expanding radar pulses — the loop is tied to the
 * live "waiting for the network" state this page represents. rAF pauses it in
 * hidden tabs; reduced motion drops the rings entirely (MotionConfig alone
 * does not stop infinite repeat loops).
 */
export function OfflineVisual() {
  const reducedMotion = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="relative mb-2 flex size-20 items-center justify-center"
    >
      {reducedMotion
        ? null
        : [0, 1].map((ring) => (
            <motion.span
              key={ring}
              className="absolute inset-0 rounded-full border-2 border-primary/40"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [0.6, 1.5], opacity: [0.65, 0] }}
              transition={{
                duration: 2.4,
                ease: "easeOut",
                repeat: Infinity,
                delay: ring * 1.2,
              }}
            />
          ))}
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WifiOffIcon className="size-6" />
      </span>
    </div>
  );
}
