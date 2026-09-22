"use client";

import * as React from "react";

import { isStorageAvailable, readReadIds } from "@/lib/notice-storage";
import { notices, todayUtc, unreadCount } from "@/lib/notices";
import { cn } from "@/lib/utils";

/**
 * How many active notices this visitor has not seen.
 *
 * Returns 0 until mounted: the count depends on localStorage, which the static
 * export cannot know. Blocked storage also yields 0 — a dot that can never be
 * cleared would be pure noise on every single visit. `readReadIds()` alone
 * cannot tell "blocked" apart from "nothing read yet" (both read as `[]`), so
 * this checks `isStorageAvailable()` first rather than trusting an empty list.
 */
export function useUnreadNoticeCount(): number {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (!isStorageAvailable()) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after mount */
    setCount(unreadCount(notices, readReadIds(), todayUtc()));
  }, []);

  return count;
}

/** Purely decorative: the count itself reaches assistive tech via the nav item's aria-label. */
export function NoticesUnreadDot({ className }: { className?: string }) {
  const count = useUnreadNoticeCount();

  if (count === 0) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full bg-primary", className)}
    />
  );
}
