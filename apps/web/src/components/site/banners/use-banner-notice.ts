"use client";

import * as React from "react";

import {
  addDismissedId,
  NOTICES_READ_EVENT,
  readDismissedIds,
  readReadIds,
} from "@/lib/notice-storage";
import { notices, pickBannerNotice, todayUtc, type Notice } from "@/lib/notices";

export type BannerNotice = { notice: Notice; dismiss: () => void };

type Seen = { dismissed: string[]; read: string[] };

function readSeen(): Seen {
  return { dismissed: readDismissedIds(), read: readReadIds() };
}

/**
 * The urgent or featured notice to show in the top bar, or null.
 *
 * Returns null until mounted: which notice qualifies depends on localStorage
 * and on the current time, neither of which the static export can know.
 * Re-reads when notices are marked read, so opening a featured notice's
 * details clears its bar without a reload.
 */
export function useBannerNotice(): BannerNotice | null {
  const [seen, setSeen] = React.useState<Seen | null>(null);

  React.useEffect(() => {
    const sync = () => setSeen(readSeen());
    sync();
    window.addEventListener(NOTICES_READ_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(NOTICES_READ_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const notice =
    seen === null ? null : pickBannerNotice(notices, todayUtc(), seen.dismissed, seen.read);

  const dismiss = React.useCallback(() => {
    if (!notice) return;
    addDismissedId(notice.id);
    setSeen((current) =>
      current ? { ...current, dismissed: [...current.dismissed, notice.id] } : current
    );
  }, [notice]);

  return notice ? { notice, dismiss } : null;
}
