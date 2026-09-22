"use client";

import { CheckIcon, ClipboardListIcon, CopyIcon, UploadIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildTemplate,
  firstFieldOffset,
  parseComposeParam,
  type ComposeKind,
} from "@/lib/compose-templates";
import { getDictionary, type Locale } from "@/lib/i18n";
import { useOnlineStatus } from "@/lib/use-online-status";

// Artalk mounts its editor from an external origin, so allow a generous window
// before deciding it is never coming.
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 10_000;

function findEditor(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(".atk-textarea");
}

function applyTemplate(editor: HTMLTextAreaElement, template: string): void {
  editor.value = template;
  // Let Artalk's own listeners sync internal state + persistence.
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
  const offset = firstFieldOffset(template);
  editor.setSelectionRange(offset, offset);
  editor.scrollIntoView({ block: "center" });
}

function clearComposeParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("compose");
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Template buttons for the guestbook, and the landing point for
 * `/comments?compose=survey|post` (the nav's 问卷 / 投稿 entries).
 *
 * Deliberately does NOT touch `localStorage.ArtalkContent`: that is Artalk's
 * global draft key, and writing it would stomp an unsent draft the visitor left
 * on another page. Injecting into the editor that is already on this page needs
 * no such hand-off.
 */
export function GuestbookCompose({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).guestbook.compose;
  const searchParams = useSearchParams();
  const online = useOnlineStatus();
  const [waitingFor, setWaitingFor] = React.useState<ComposeKind | null>(null);
  const [confirming, setConfirming] = React.useState<ComposeKind | null>(null);
  const [fallback, setFallback] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const insert = React.useCallback(
    (kind: ComposeKind, force: boolean) => {
      const template = buildTemplate(kind, locale);
      const editor = findEditor();
      if (!editor) {
        setWaitingFor(kind);
        return;
      }
      // Never stomp what the visitor typed — ask first.
      if (!force && editor.value.trim() && editor.value !== template) {
        setConfirming(kind);
        return;
      }
      applyTemplate(editor, template);
      setConfirming(null);
    },
    [locale]
  );

  React.useEffect(() => {
    if (!waitingFor) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const editor = findEditor();
      if (editor) {
        window.clearInterval(timer);
        applyTemplate(editor, buildTemplate(waitingFor, locale));
        setWaitingFor(null);
        return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(timer);
        // The button must not fail silently: hand the text over instead.
        setFallback(buildTemplate(waitingFor, locale));
        setWaitingFor(null);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [waitingFor, locale]);

  const requested = parseComposeParam(searchParams.get("compose"));
  const hasComposeParam = searchParams.has("compose");

  React.useEffect(() => {
    if (!hasComposeParam) return;
    if (requested) {
      // The ?compose= hand-off starts on arrival by design, mirroring
      // GuestbookPrefill's mount-time draft hand-off in the same file group.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      insert(requested, false);
    }
    // An unrecognised value is dropped too — no error, no dirty URL left behind.
    clearComposeParam();
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per arrival, not per insert identity */
  }, [requested, hasComposeParam]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const buttons: { kind: ComposeKind; label: string; icon: React.ReactNode }[] = [
    { kind: "post", label: copy.post, icon: <UploadIcon data-icon="inline-start" aria-hidden="true" /> },
    { kind: "survey", label: copy.survey, icon: <ClipboardListIcon data-icon="inline-start" aria-hidden="true" /> },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-sm font-medium">{copy.heading}</p>
      <div className="flex flex-wrap gap-2">
        {buttons.map((button) => (
          <Button
            key={button.kind}
            type="button"
            variant="outline"
            size="sm"
            disabled={!online}
            onClick={() => insert(button.kind, false)}
          >
            {button.icon}
            {button.label}
          </Button>
        ))}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{copy.replaceQuestion}</span>
          <Button type="button" size="sm" onClick={() => insert(confirming, true)}>
            {copy.replaceConfirm}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
            {copy.replaceCancel}
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {online ? copy.publicNotice : copy.offline}
      </p>
      {fallback ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">{copy.unavailable}</p>
          <Textarea readOnly value={fallback} rows={6} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => {
              // Optional chaining on a missing clipboard API would `await undefined`
              // and fake success — guard explicitly.
              if (!navigator.clipboard) return;
              void navigator.clipboard.writeText(fallback).then(() => setCopied(true)).catch(() => undefined);
            }}
          >
            {copied ? (
              <CheckIcon data-icon="inline-start" aria-hidden="true" />
            ) : (
              <CopyIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {copied ? copy.copied : copy.copy}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
