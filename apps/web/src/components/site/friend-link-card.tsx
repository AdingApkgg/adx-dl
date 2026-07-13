"use client";

import type { Variants } from "framer-motion";
import { ArrowUpRightIcon } from "lucide-react";

import { motion, springSoft } from "@/components/motion";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const cardVariants: Variants = {
  rest: { y: 0 },
  hover: { y: -3 },
};

// A stiff, underdamped spring so the arrow overshoots — it "launches" toward
// the card's corner instead of sliding there.
const arrowVariants: Variants = {
  rest: { x: 0, y: 0 },
  hover: { x: 3, y: -3, transition: { type: "spring", stiffness: 550, damping: 12 } },
};

type FriendLinkCardProps = {
  href: string;
  name: string;
  description: string;
  hostname: string;
  ariaLabel: string;
};

/**
 * One friend-link card: the whole anchor lifts on hover while the corner arrow
 * follows via variant propagation. Rest state is the identity transform, so the
 * SSR HTML stays fully visible.
 */
export function FriendLinkCard({
  href,
  name,
  description,
  hostname,
  ariaLabel,
}: FriendLinkCardProps) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={ariaLabel}
      initial="rest"
      whileHover="hover"
      whileTap={{ scale: 0.98 }}
      variants={cardVariants}
      transition={springSoft}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors group-hover:ring-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <span>{name}</span>
            <motion.span
              aria-hidden="true"
              variants={arrowVariants}
              className="inline-flex shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
            >
              <ArrowUpRightIcon className="size-4" />
            </motion.span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
          <span className="text-xs text-muted-foreground/80">{hostname}</span>
        </CardHeader>
      </Card>
    </motion.a>
  );
}
