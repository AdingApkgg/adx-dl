"use client";

import { getDictionary, type Locale } from "@/lib/i18n";
import { formatBytes } from "./format-bytes";

/** Native checkbox stays visible and makes the whole row tappable on phones. */
export function DownloadVideoOption({ locale, checked, onChange, videoBytes, disabled }: {
  locale: Locale;
  checked: boolean;
  onChange: (checked: boolean) => void;
  videoBytes: number;
  disabled: boolean;
}) {
  const { detail, downloads } = getDictionary(locale);
  return (
    <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/70 px-2.5 py-2 text-xs has-disabled:cursor-default has-disabled:opacity-60">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} disabled={disabled} className="size-4 shrink-0 accent-primary" />
      <span className="font-medium">{detail.downloadIncludeVideo}</span>
      <span className="text-muted-foreground">{videoBytes > 0 ? downloads.videoOffSavings(formatBytes(videoBytes)) : downloads.videoOptionHint}</span>
    </label>
  );
}
