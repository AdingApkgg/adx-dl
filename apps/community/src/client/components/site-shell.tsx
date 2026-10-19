import {DownloadDock} from "./download-actions";
import {LibrarySelectionBar} from "./library-actions";
import { useLocation } from "react-router";
import { deLocalizeHref } from "@/paraglide/runtime.js";
import type { ReactNode } from "react";

import { LocaleSuggestion } from "./locale-suggestion";
import { SiteHeader } from "./site-header";

// :lang? 布局的外壳：页头，页头下面是浏览器语言不一致时的切换提示，再下面是统一宽度和边距的内容区（spec 第 7.2 节）。
// 出错页面也套在里面，页头照样在。
export function SiteShell({ children }: { children: ReactNode }) {
  const path = deLocalizeHref(useLocation().pathname);
  const publicCharts = path === "/" || path === "/charts" || path.startsWith("/charts/");
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <LocaleSuggestion />
      <div className={`mx-auto w-full ${publicCharts ? "max-w-7xl" : "max-w-3xl"} flex-1 px-4 py-8`}><LibrarySelectionBar/>{children}</div>
      <DownloadDock/>
    </div>
  );
}
