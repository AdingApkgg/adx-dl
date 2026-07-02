"use client";

import { useState } from "react";
import { ChevronDownIcon, KeyboardIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

const TITLE: Record<Locale, string> = {
  zh: "键盘快捷键",
  en: "Keyboard shortcuts",
  ja: "キーボードショートカット",
};

const ROWS: Record<Locale, [string, string][]> = {
  zh: [
    ["Space", "播放 / 暂停"],
    ["← →", "步进位置"],
    ["↑ ↓", "流速"],
    [", .", "上 / 下一小节"],
    ["R", "重播当前小节"],
    ["F", "全屏"],
  ],
  en: [
    ["Space", "Play / pause"],
    ["← →", "Step position"],
    ["↑ ↓", "Hi-speed"],
    [", .", "Prev / next measure"],
    ["R", "Replay measure"],
    ["F", "Fullscreen"],
  ],
  ja: [
    ["Space", "再生 / 一時停止"],
    ["← →", "位置ステップ"],
    ["↑ ↓", "ハイスピード"],
    [", .", "前 / 次の小節"],
    ["R", "現在の小節を再生"],
    ["F", "全画面"],
  ],
};

export function ChartShortcuts({
  locale = "zh",
  hint,
}: {
  locale?: Locale;
  /** Localized note that shortcuts require the player to be focused. */
  hint?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <KeyboardIcon className="size-4" aria-hidden="true" />
          {TITLE[locale]}
        </span>
        <ChevronDownIcon
          className={cn("size-4 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <>
          {hint ? <p className="px-4 pb-2 text-xs text-muted-foreground">{hint}</p> : null}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 pb-4 sm:grid-cols-2">
            {ROWS[locale].map(([key, desc]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {key}
                </kbd>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </div>
  );
}

export default ChartShortcuts;
