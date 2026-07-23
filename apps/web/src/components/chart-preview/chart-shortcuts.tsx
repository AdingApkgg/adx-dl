"use client";

import { KeyboardIcon } from "lucide-react";
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
    ["Shift+← →", "步进小节"],
    ["↑ ↓", "流速"],
    [", .", "上 / 下一小节"],
    ["R", "重播当前小节"],
    ["F", "全屏"],
  ],
  en: [
    ["Space", "Play / pause"],
    ["← →", "Step position"],
    ["Shift+← →", "Step measure"],
    ["↑ ↓", "Hi-speed"],
    [", .", "Prev / next measure"],
    ["R", "Replay measure"],
    ["F", "Fullscreen"],
  ],
  ja: [
    ["Space", "再生 / 一時停止"],
    ["← →", "位置ステップ"],
    ["Shift+← →", "小節ステップ"],
    ["↑ ↓", "ハイスピード"],
    [", .", "前 / 次の小節"],
    ["R", "現在の小節を再生"],
    ["F", "全画面"],
  ],
};

// Always expanded (upstream parity): the reference card is a plain static
// list, so the shortcuts stay discoverable without an extra click.
export function ChartShortcuts({
  locale = "zh",
  hint,
}: {
  locale?: Locale;
  /** Localized note that shortcuts require the player to be focused. */
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <p className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-medium">
        <KeyboardIcon className="size-4" aria-hidden="true" />
        {TITLE[locale]}
      </p>
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
    </div>
  );
}

export default ChartShortcuts;
