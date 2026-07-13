"use client";

import { CheckIcon } from "lucide-react";

import { motion, springSoft } from "@/components/motion";
import { cn } from "@/lib/utils";

/**
 * Select-mode corner badge for ChartCard. A client island so the (server)
 * card keeps rendering static HTML on the home page: the badge spring-pops in
 * when select mode turns on, and the check tick springs on selection.
 */
export function SelectCheckBadge({ selected }: { selected: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springSoft}
      className={cn(
        "absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border shadow-sm transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/70 bg-background/80 text-transparent"
      )}
    >
      <motion.span
        className="flex"
        initial={false}
        animate={selected ? { scale: 1, rotate: 0 } : { scale: 0.4, rotate: -20 }}
        transition={springSoft}
      >
        <CheckIcon className="size-4" />
      </motion.span>
    </motion.span>
  );
}
