import { ThemeProvider } from "@astrodx/ui/theme";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach } from "vitest";

// 不开 vitest 的 globals 时，Testing Library 不会自己打开 React 的 act 环境；不开的话，漏在 act() 外面的状态更新
// 不会报警告。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 每个用例结束后把页面恢复原样（做法和 @astrodx/ui 的 vitest.setup.ts 一样）：设置面板和提示条会写 localStorage
// 和 <html>（dark 类、color-scheme、data-accent、data-motion、data-reduced-motion），用例还可能换过地址。
afterEach(() => {
  cleanup();
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
