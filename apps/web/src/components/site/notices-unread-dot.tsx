"use client";

import * as React from "react";

import { isStorageAvailable, NOTICES_READ_EVENT, readReadIds } from "@/lib/notice-storage";
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
 * Subscribes to whatever can change the unread count: this tab marking
 * notices read (`NOTICES_READ_EVENT`, dispatched by `markRead` in
 * notice-storage.ts) and another tab doing the same (the native `storage`
 * event). Plain function — see notice-storage.test.ts, which exercises it
 * directly without mounting anything.
 */
export function subscribeUnreadNoticeCount(onStoreChange: () => void): () => void {
  window.addEventListener(NOTICES_READ_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(NOTICES_READ_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** The live snapshot, always against the real build-time notice list. */
export function getUnreadNoticeCountSnapshot(): number {
  return unreadDotCount();
}

/**
 * The server always renders 0 unread: the count depends on localStorage,
 * which a static export cannot know. Load-bearing — it must match what the
 * prerendered HTML shows, or hydration mismatches.
 */
export function getUnreadNoticeCountServerSnapshot(): number {
  return 0;
}

/**
 * How many active notices this visitor has not seen.
 *
 * `useSyncExternalStore` rather than a one-time mount effect: `SiteHeader`
 * renders outside `PageTransition` and the App Router does not remount a
 * layout on client-side navigation, so a one-time read left the dot stuck lit
 * after visiting /notices marked everything read. This re-renders every
 * subscriber — the header and each `NoticesUnreadDot` — the moment that
 * happens, in this tab or another one.
 */
export function useUnreadNoticeCount(): number {
  return React.useSyncExternalStore(
    subscribeUnreadNoticeCount,
    getUnreadNoticeCountSnapshot,
    getUnreadNoticeCountServerSnapshot
  );
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
