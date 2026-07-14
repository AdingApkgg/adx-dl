"use client";


import { RotateCwIcon } from "lucide-react";
import * as React from "react";

import { motion, springSoft, useReducedMotion } from "@/components/motion";

// The offline page's JS chunks are precached with the app shell (see
// serwist.config.mjs), so this hydrates and works without a network.
export function RetryButton({ label }: { label: string }) {
  const reducedMotion = useReducedMotion();
  const [reloading, setReloading] = React.useState(false);
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      transition={springSoft}
      onClick={() => {
        setReloading(true);
        window.location.reload();
      }}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {/* Spins only while the reload is in flight; reduced motion keeps it
          still (MotionConfig does not stop infinite repeat loops). */}
      <motion.span
        aria-hidden="true"
        className="inline-flex"
        animate={reloading && !reducedMotion ? { rotate: 360 } : undefined}
        transition={{ duration: 0.7, ease: "linear", repeat: Infinity }}
      >
        <RotateCwIcon className="size-4" />
      </motion.span>
      {label}
    </motion.button>
  );
}
