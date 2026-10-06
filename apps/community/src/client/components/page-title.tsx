import type { ReactNode } from "react";

// 页面标题（spec 第 7.2 节）：每个页面一个 <h1>，下面可以跟一行说明。
export function PageTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** 正文里的文字链接（按钮样式的链接用 Button asChild）。 */
export const textLinkClass = "font-medium text-primary underline-offset-4 hover:underline";
