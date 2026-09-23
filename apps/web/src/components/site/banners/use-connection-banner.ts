"use client";

import * as React from "react";

import { useOnlineStatus } from "@/lib/use-online-status";

/** How long the "back online" confirmation stays up before fading out. */
const RESTORED_MS = 3000;

export type ConnectionBannerState = "offline" | "restored" | null;

export function useConnectionBanner(): ConnectionBannerState {
  const online = useOnlineStatus();
  const [showRestored, setShowRestored] = React.useState(false);
  const [previousOnline, setPreviousOnline] = React.useState(online);

  // Adjusting state during render (rather than in an effect) is React's
  // documented pattern for reacting to a changed input: going offline clears
  // any lingering confirmation, and coming back from offline arms one.
  if (previousOnline !== online) {
    setPreviousOnline(online);
    setShowRestored(online && !previousOnline);
  }

  React.useEffect(() => {
    if (!showRestored) return;
    const timer = setTimeout(() => setShowRestored(false), RESTORED_MS);
    return () => clearTimeout(timer);
  }, [showRestored]);

  if (!online) return "offline";
  return showRestored ? "restored" : null;
}
