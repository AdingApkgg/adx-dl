import type { Metadata } from "next";

import { NotFoundView } from "@/app/not-found-view";
import { RootLayoutShell } from "@/app/root-layout-shell";

// Global 404: unmatched URLs across the whole app land here, and the static
// export writes this route out as `out/404.html` — the page GitHub Pages serves
// for every bad URL. The root layout is a pass-through (the html/body shells
// live in the route groups), so this page renders the full document itself via
// RootLayoutShell. Excluded from indexing: it is infrastructure, not content.
export const metadata: Metadata = {
  title: "404 · ADX 谱面资源",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <RootLayoutShell lang="zh-CN" locale="zh">
      <NotFoundView />
    </RootLayoutShell>
  );
}
