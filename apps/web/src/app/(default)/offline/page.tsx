import Link from "next/link";
import type { Metadata } from "next";

// Static fallback served by the service worker when a navigation fails offline
// (precached as /offline.html — see serwist.config.js + src/sw.ts `fallbacks`).
// Excluded from indexing: it is infrastructure, not content.
export const metadata: Metadata = {
  title: "离线 · ADX 谱面资源",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">Offline</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">当前处于离线状态</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        无法连接到网络。已缓存的页面和封面仍可浏览；恢复网络后请重试。
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        You appear to be offline. Cached pages and covers are still available — reconnect and try again.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        返回首页
      </Link>
    </main>
  );
}
