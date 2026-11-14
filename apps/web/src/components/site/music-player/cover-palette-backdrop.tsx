"use client";
import { memo } from "react";
import { AnimatePresence, motion, motionTokens, useReducedMotion } from "@astrodx/ui/motion";
import { coverPaletteStyle } from "@/lib/cover-palette";

/** Static gradients crossfade via compositor opacity; no image, canvas or blur. */
export const CoverPaletteBackdrop = memo(function CoverPaletteBackdrop({
  palette,
}: {
  palette?: unknown;
}) {
  const reduced = useReducedMotion();
  const colours = coverPaletteStyle(palette);
  const background = `linear-gradient(145deg, ${colours["--cover-background"]}, ${colours["--cover-background-end"]})`;
  if (reduced)
    return (
      <div
        aria-hidden="true"
        data-cover-palette-backdrop
        className="pointer-events-none absolute inset-0"
        style={{ background }}
      />
    );
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={background}
        aria-hidden="true"
        data-cover-palette-backdrop
        className="pointer-events-none absolute inset-0"
        style={{ background }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: motionTokens.duration.default / 1000,
          ease: motionTokens.easing.enter,
        }}
      />
    </AnimatePresence>
  );
});
