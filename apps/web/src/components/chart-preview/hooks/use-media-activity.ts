"use client";

import { useEffect } from "react";

import { type MediaOwner, setMediaActive } from "@/lib/media-coordination";

/**
 * Publishes "this surface is playing" for as long as `active` holds — and
 * clears it on unmount, so closing the preview mid-playback doesn't leave the
 * rest of the site thinking it still runs. See setMediaActive.
 */
export function useMediaActivity(owner: MediaOwner, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    setMediaActive(owner, true);
    return () => setMediaActive(owner, false);
  }, [owner, active]);
}
