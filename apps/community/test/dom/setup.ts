import { toast } from "@astrodx/ui/components/sonner";
import { ThemeProvider } from "@astrodx/ui/theme";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach } from "vitest";

// 不开 vitest 的 globals 时，Testing Library 不会自己打开 React 的 act 环境；不开的话，漏在 act() 外面的状态更新
// 不会报警告。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Happy DOM 20.14 提前创建 Animation.finished，取消未读取的动画会产生
// Chromium 最小复现中不存在的未处理 AbortError。仅标记该取消拒绝已处理：
// 显式读取 finished 的调用方仍收到拒绝，其他拒绝继续令测试失败。
if (typeof window !== "undefined" && window.Animation) {
  const cancel = window.Animation.prototype.cancel;
  window.Animation.prototype.cancel = function () {
    void this.finished.catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });
    return cancel.call(this);
  };
}

// 每个用例结束后把页面恢复原样（做法和 @astrodx/ui 的 vitest.setup.ts 一样，另外关掉 Sonner 的提示、换回地址）：设置面板和提示条会写 localStorage
// 和 <html>（dark 类、color-scheme、data-accent、data-motion、data-reduced-motion），用例还可能换过地址。
afterEach(() => {
  // Sonner 把提示记在模块里，新挂的 Toaster 会把还没消失的重放出来：每个用例结束时全部关掉。
  act(() => {
    toast.dismiss();
  });
  cleanup();
  // 用例可以改用 node 环境（// @vitest-environment node），那里没有页面可恢复。
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  // ThemeProvider 把最后的选择记在模块变量里，只有挂着的 Provider 收到 storage 事件才会清掉：临时挂一个，发一次事件。
  render(createElement(ThemeProvider, null, null));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage"));
  });
  cleanup();
  const html = document.documentElement;
  html.removeAttribute("class");
  html.removeAttribute("style");
  for (const name of html.getAttributeNames()) {
    if (name.startsWith("data-")) html.removeAttribute(name);
  }
  window.history.replaceState(null, "", "/");
});
