import type { ReactNode } from "react";

import { LocaleSuggestion } from "./locale-suggestion";
import { SiteHeader } from "./site-header";

// :lang? 布局的外壳：页头，下面是统一宽度和边距的内容区（spec 第 7.2 节）。出错页面也套在里面，页头照样在。
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <LocaleSuggestion />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</div>
    </div>
  );
}
