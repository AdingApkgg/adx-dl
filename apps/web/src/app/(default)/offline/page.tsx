import Link from "next/link";
import type { Metadata } from "next";

import { RetryButton } from "./retry-button";
import { getDictionary } from "@/lib/i18n";

// Static fallback served by the service worker when a navigation fails offline
// (precached as /offline.html — see serwist.config.js + src/sw.ts `fallbacks`).
// It is ONE page served for every locale, so the zh/en/ja strings are stacked.
// Excluded from indexing: it is infrastructure, not content.
export const metadata: Metadata = {
  title: "离线 · ADX 谱面资源",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  const zh = getDictionary("zh").offline;
  const en = getDictionary("en").offline;
  const ja = getDictionary("ja").offline;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Offline</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{zh.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{zh.description}</p>
      <p lang="en" className="max-w-md text-xs text-muted-foreground">
        {en.description}
      </p>
      <p lang="ja" className="max-w-md text-xs text-muted-foreground">
        {ja.description}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <RetryButton label={`${zh.retry} · ${en.retry} · ${ja.retry}`} />
        <Link
          href="/"
          className="rounded-md border border-border/70 bg-background/70 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          {zh.backHome}
        </Link>
      </div>
    </main>
  );
}
