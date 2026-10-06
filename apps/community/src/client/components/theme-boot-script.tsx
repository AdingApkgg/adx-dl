import { themeBootScript } from "@astrodx/ui/theme";
import { useContext } from "react";

import { NonceContext } from "../lib/nonce";

const BOOT_SCRIPT = themeBootScript();

// 防闪烁脚本（来自 @astrodx/ui，和 ThemeProvider、MotionProvider 用同一份存储键）。内联在 <head> 里，解析到这里就执行：
// 页面第一次绘制之前，<html> 上已经有 dark 类、color-scheme、data-accent、data-motion。CSP 只放行带本次 nonce 的
// 内联脚本。浏览器拿到页面后会把 nonce 属性清空，hydrate 时这里的 nonce 也是 undefined，两边对不上是预期的，
// 所以加 suppressHydrationWarning。
export function ThemeBootScript() {
  const nonce = useContext(NonceContext);
  return (
    <script
      id="theme-init"
      nonce={nonce}
      suppressHydrationWarning
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed boot script from @astrodx/ui (no user input) that must run before first paint
      dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }}
    />
  );
}
