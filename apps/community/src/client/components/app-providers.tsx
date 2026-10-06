import { Toaster } from "@astrodx/ui/components/sonner";
import { MotionProvider } from "@astrodx/ui/motion";
import { ThemeProvider } from "@astrodx/ui/theme";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";

// 主题、强调色和减少动画（spec 第 7.1 节），嵌套方式和 web 一样。设置存在 localStorage，键名和 web 相同。
// 全局提示（toast，spec 第 7.3 节）在这里挂一次，跟着 ThemeProvider 解析出的深浅色。
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <MotionProvider>
        {children}
        <Toaster containerAriaLabel={m.toast_region()} />
      </MotionProvider>
    </ThemeProvider>
  );
}
