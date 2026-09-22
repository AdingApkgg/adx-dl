"use client";

import * as React from "react";

import { addDismissedId, readDismissedIds } from "@/lib/notice-storage";
import { notices, pickUrgentNotice, todayUtc, type Notice } from "@/lib/notices";

export type UrgentNotice = { notice: Notice; dismiss: () => void };

/**
 * The urgent notice to show, or null.
 *
 * Returns null until mounted: which notice qualifies depends on localStorage
 * and on the current time, neither of which the static export can know.
 */
export function useUrgentNotice(): UrgentNotice | null {
  const [dismissedIds, setDismissedIds] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after mount */
    setDismissedIds(readDismissedIds());
  }, []);

  const notice = dismissedIds === null ? null : pickUrgentNotice(notices, todayUtc(), dismissedIds);

  const dismiss = React.useCallback(() => {
    if (!notice) return;
    addDismissedId(notice.id);
    setDismissedIds((current) => [...(current ?? []), notice.id]);
  }, [notice]);

  return notice ? { notice, dismiss } : null;
}
