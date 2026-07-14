"use client";

import { ArrowUpRightIcon, CheckIcon, CopyIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type DonateAddressCardProps = {
  title: string;
  description: string;
  address: string;
  copyLabel: string;
  copiedLabel: string;
  /** Public block-explorer page for the address (e.g. Tronscan). */
  explorerUrl: string;
  explorerLabel: string;
};

/**
 * Wallet-address donation card: the address is selectable text plus a
 * copy-to-clipboard button with a transient "copied" confirmation, mirroring
 * the share button on the chart detail page.
 */
export function DonateAddressCard({
  title,
  description,
  address,
  copyLabel,
  copiedLabel,
  explorerUrl,
  explorerLabel,
}: DonateAddressCardProps) {
  const [copied, setCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const handleCopy = React.useCallback(async () => {
    let ok = false;
    try {
      if (!navigator.clipboard) {
        // Absent API (non-secure context, old WebViews) must not fake success —
        // route through the same fallback as a denied write.
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(address);
      ok = true;
    } catch {
      // Async clipboard denied (e.g. embedded webviews) — fall back to the
      // legacy selection-based copy, which works within a click gesture.
      const textarea = document.createElement("textarea");
      textarea.value = address;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        // Both paths failed — the address stays selectable by hand.
      }
      textarea.remove();
    }
    if (!ok) {
      return;
    }
    setCopied(true);
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [address]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-border/60 bg-muted/50 px-3 py-2 font-mono text-xs sm:text-sm">
          {address}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-live="polite"
          className="shrink-0"
        >
          {copied ? (
            <CheckIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {copied ? copiedLabel : copyLabel}
        </Button>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {explorerLabel}
          <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
        </a>
      </CardContent>
    </Card>
  );
}
