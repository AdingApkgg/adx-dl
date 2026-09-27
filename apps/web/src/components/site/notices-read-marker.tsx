"use client";

import * as React from "react";

import { markRead } from "@/lib/notice-storage";

/**
 * Marks the notices listed on this page as read, then renders nothing.
 *
 * Split out of `NoticesView` so the list itself stays a server component —
 * the page is statically exported and its content must be in the HTML.
 */
export function NoticesReadMarker({ ids }: { ids: string[] }) {
  // Join into a primitive: the parent hands over a fresh array on every render,
  // which as a dependency would re-run the effect forever.
  const key = ids.join(",");

  React.useEffect(() => {
    if (!key) return;
    markRead(key.split(","));
  }, [key]);

  return null;
}
