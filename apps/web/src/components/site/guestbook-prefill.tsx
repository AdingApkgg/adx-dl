"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

// Artalk persists the editor's unsent draft under this localStorage key and
// restores it when the widget mounts — seeding it before init is the primary
// prefill path. The DOM fallback below covers the race where Artalk mounted
// first (or the key ever changes upstream).
const ARTALK_DRAFT_KEY = "ArtalkContent";

// How long to wait for Artalk's editor to appear before giving up (it loads
// from an external origin, so allow a generous window).
const EDITOR_POLL_INTERVAL_MS = 250;
const EDITOR_POLL_TIMEOUT_MS = 10_000;

/**
 * Reads `?draft=` (written by the /post and /survey forms) and prefills the
 * guestbook's Artalk editor with it. Renders nothing; must be wrapped in
 * <Suspense> because of useSearchParams.
 */
export function GuestbookPrefill() {
  const searchParams = useSearchParams();
  const draft = searchParams.get("draft");

  React.useEffect(() => {
    if (!draft) {
      return;
    }
    try {
      window.localStorage.setItem(ARTALK_DRAFT_KEY, draft);
    } catch {
      // Storage unavailable — the DOM path below still applies the draft.
    }

    // Strip the param so a later refresh doesn't clobber whatever the user
    // has since typed or cleared.
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    window.history.replaceState(window.history.state, "", url);

    let cancelled = false;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      const textarea = document.querySelector<HTMLTextAreaElement>(".atk-textarea");
      if (!textarea) {
        if (Date.now() - startedAt > EDITOR_POLL_TIMEOUT_MS) {
          window.clearInterval(timer);
        }
        return;
      }
      window.clearInterval(timer);
      // Only overwrite an empty editor — never stomp text the user typed
      // (or a restored draft, which is this same content anyway).
      if (!textarea.value.trim() || textarea.value === draft) {
        textarea.value = draft;
        // Let Artalk's own listeners sync internal state + persistence.
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
      textarea.focus();
      textarea.scrollIntoView({ block: "center" });
    }, EDITOR_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [draft]);

  return null;
}
