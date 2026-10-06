import { MotionProvider } from "@astrodx/ui/motion";
import { ThemeProvider } from "@astrodx/ui/theme";
import type { ReactNode } from "react";

// 主题、强调色和减少动画（spec 第 7.1 节），嵌套方式和 web 一样。设置存在 localStorage，键名和 web 相同。
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <MotionProvider>{children}</MotionProvider>
    </ThemeProvider>
  );
}
