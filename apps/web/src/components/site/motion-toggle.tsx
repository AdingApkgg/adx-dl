"use client";

import { ZapIcon, ZapOffIcon } from "lucide-react";

import { useMotionPreference } from "@/components/motion";
import { Button } from "@/components/ui/button";

type MotionToggleLabels = {
  label: string;
  enabledHint: string;
};

/**
 * Header quick toggle for the site-level "reduce motion" preference. Pressed
 * state means animations are reduced: framer drops JS-driven transform/layout
 * animations and the CSS guards in globals.css disable view transitions and
 * marquees, leaving only plain CSS transitions.
 */
export function MotionToggle({ labels }: { labels: MotionToggleLabels }) {
  const { userReduced, setUserReduced } = useMotionPreference();
  const title = userReduced ? labels.enabledHint : labels.label;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={title}
      title={title}
      aria-pressed={userReduced}
      onClick={() => setUserReduced(!userReduced)}
      className={userReduced ? "text-muted-foreground" : undefined}
    >
      {userReduced ? <ZapOffIcon aria-hidden="true" /> : <ZapIcon aria-hidden="true" />}
    </Button>
  );
}
