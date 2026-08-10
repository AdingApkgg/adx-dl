"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";
import { AlertTriangleIcon, CheckIcon, CopyIcon, Loader2Icon } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { contactChannels } from "@/lib/community-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Artalk persists the editor's unsent draft under this localStorage key and
// restores it when the widget mounts — seeding it before init is the primary
// prefill path. The DOM fallback below covers the race where Artalk mounted
// first (or the key ever changes upstream).
const ARTALK_DRAFT_KEY = "ArtalkContent";

// How long to wait for Artalk's editor to appear before giving up (it loads
// from an external origin, so allow a generous window).
const EDITOR_POLL_INTERVAL_MS = 250;
const EDITOR_POLL_TIMEOUT_MS = 10_000;

type PrefillState = "idle" | "pending" | "success" | "failed";

/**
 * Reads `?draft=` (written by the /post and /survey forms) and prefills the
 * guestbook's Artalk editor with it.
 *
 * This used to render nothing, strip `?draft=` on mount and give up silently
 * when Artalk never appeared — so a user who had just filled in a submission
 * form watched their text vanish with no explanation and no way to get it back.
 * The hand-off is now visible, the param survives until it has actually
 * succeeded, and a failure hands the text back with a copy button.
 */
export function GuestbookPrefill({ locale = "zh" }: { locale?: Locale }) {
  const searchParams = useSearchParams();
  const draft = searchParams.get("draft");
  const copy = getDictionary(locale).guestbook.prefill;
  const [state, setState] = React.useState<PrefillState>("idle");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!draft) {
      return;
    }
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- the hand-off starts on mount by design */
    setState("pending");
    try {
      window.localStorage.setItem(ARTALK_DRAFT_KEY, draft);
    } catch {
      // Storage unavailable — the DOM path below still applies the draft.
    }

    let cancelled = false;
    const startedAt = Date.now();
    const clearDraftParam = (): void => {
      // Only after the text is safely in the editor. Clearing it up front (the
      // old behaviour) meant a failed injection destroyed the only copy.
      const url = new URL(window.location.href);
      url.searchParams.delete("draft");
      window.history.replaceState(window.history.state, "", url);
    };
    const timer = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      const textarea = document.querySelector<HTMLTextAreaElement>(".atk-textarea");
      if (!textarea) {
        if (Date.now() - startedAt > EDITOR_POLL_TIMEOUT_MS) {
          window.clearInterval(timer);
          setState("failed");
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
      clearDraftParam();
      setState("success");
    }, EDITOR_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [draft]);

  React.useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (state === "idle" || draft === null) {
    return null;
  }

  if (state === "failed") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
          {copy.failedTitle}
        </p>
        <p className="text-sm text-muted-foreground">{copy.failedBody}</p>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {copy.draftLabel}
          <Textarea readOnly value={draft} rows={6} className="font-normal" />
        </label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(draft)
                .then(() => setCopied(true))
                // The textarea above stays selectable either way, which is the
                // point of rendering it rather than only offering a button.
                .catch(() => undefined);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {copied ? (
              <CheckIcon className="size-3.5" aria-hidden="true" />
            ) : (
              <CopyIcon className="size-3.5" aria-hidden="true" />
            )}
            {copied ? copy.copied : copy.copy}
          </button>
          {contactChannels.map((channel) => (
            <a
              key={channel.url}
              href={channel.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {channel.name[locale]}
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <p
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        state === "success"
          ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      {state === "success" ? (
        <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      ) : (
        <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      )}
      {state === "success" ? copy.success : copy.pending}
    </p>
  );
}
