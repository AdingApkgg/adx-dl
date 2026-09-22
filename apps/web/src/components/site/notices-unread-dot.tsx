"use client";

import * as React from "react";

import { isStorageAvailable, readReadIds } from "@/lib/notice-storage";
import { notices, todayUtc, unreadCount, type Notice } from "@/lib/notices";
import { cn } from "@/lib/utils";

/**
 * The number the dot shows.
 *
 * Kept out of the hook so the gate below is testable: `readReadIds()` returns
 * `[]` both when nothing has been read and when storage threw, so without the
 * availability check a blocked-storage visitor would read as "everything
 * unread" and get a dot that can never be cleared.
 */
export function unreadDotCount(list: Notice[] = notices): number {
  if (!isStorageAvailable()) {
    return 0;
  }
  return unreadCount(list, readReadIds(list), todayUtc());
}

/**
 * How many active notices this visitor has not seen.
 *
 * Returns 0 until mounted: the count depends on localStorage, which the static
 * export cannot know.
 */
export function useUnreadNoticeCount(): number {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after mount */
    setCount(unreadDotCount());
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
