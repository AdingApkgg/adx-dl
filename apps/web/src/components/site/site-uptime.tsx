"use client";

import { useEffect, useState } from "react";

import type { Locale } from "@/lib/i18n";

/** First commit of the archive (repo epoch) — the site's founding moment. */
const SITE_FOUNDED_AT = Date.parse("2026-06-13T08:32:39+08:00");

type Labels = {
  founded: string;
  separator: string;
  running: string;
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

const LABELS: Record<Locale, Labels> = {
  zh: {
    founded: "本站始建于 2026 年 06 月 13 日",
    separator: "，",
    running: "已稳定运行",
    days: " 天 ",
    hours: " 时 ",
    minutes: " 分 ",
    seconds: " 秒",
  },
  en: {
    founded: "Online since June 13, 2026",
    separator: " — ",
    running: "running for",
    days: "d ",
    hours: "h ",
    minutes: "m ",
    seconds: "s",
  },
  ja: {
    founded: "2026 年 06 月 13 日開設",
    separator: "、",
    running: "稼働時間",
    days: " 日 ",
    hours: " 時間 ",
    minutes: " 分 ",
    seconds: " 秒",
  },
};

function formatUptime(labels: Labels, elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${days}${labels.days}${hours}${labels.hours}${minutes}${labels.minutes}${seconds}${labels.seconds}`;
}

/**
 * Footer founding-date line with a live uptime ticker (blog parity). The
 * counter only exists client-side: it starts empty on the server-rendered
 * HTML and fills in after hydration, so the per-second text never causes a
 * hydration mismatch.
 */
export function SiteUptime({ locale }: { locale: Locale }) {
  const t = LABELS[locale];
  const [uptime, setUptime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setUptime(formatUptime(t, Date.now() - SITE_FOUNDED_AT));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [t]);

  return (
    <p className="text-xs text-muted-foreground">
      {t.founded}
      {uptime ? (
        <>
          {t.separator}
          {t.running}{" "}
          <span className="font-mono tabular-nums">{uptime}</span>
        </>
      ) : null}
    </p>
  );
}
