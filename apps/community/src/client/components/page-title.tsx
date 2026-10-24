import { MotionSurface } from "./motion-ui";
import type { ReactNode } from "react";

// 页面标题（spec 第 7.2 节）：每个页面一个 <h1>，下面可以跟一行说明。
export function PageTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <MotionSurface className="min-w-0 space-y-2">
      <h1 className="text-balance break-words text-2xl font-bold tracking-tight sm:text-3xl">{children}</h1>
      {description ? <p className="max-w-2xl text-pretty text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </MotionSurface>
  );
}

/** 正文里的文字链接（按钮样式的链接用 Button asChild）。 */
export const textLinkClass = "font-medium text-primary underline-offset-4 hover:underline";
