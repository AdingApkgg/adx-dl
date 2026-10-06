import { themeBootScript } from "@astrodx/ui/theme";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";

import { NonceContext } from "../lib/nonce";
import { ThemeBootScript } from "./theme-boot-script";

describe("防闪烁脚本", () => {
  // 服务端入口把本次请求的 nonce 放进 NonceContext（和交给 <ServerRouter> 的是同一个）；CSP 只放行带它的内联脚本。
  test("带着本次请求的 nonce，内容就是 @astrodx/ui 的 themeBootScript()", () => {
    const html = renderToStaticMarkup(
      <NonceContext value="nonce-for-test">
        <ThemeBootScript />
      </NonceContext>
    );

    expect(html).toBe(`<script id="theme-init" nonce="nonce-for-test">${themeBootScript()}</script>`);
  });

  test("没有 nonce 时（浏览器里 hydrate）不输出 nonce 属性", () => {
    expect(renderToStaticMarkup(<ThemeBootScript />)).toBe(`<script id="theme-init">${themeBootScript()}</script>`);
  });
});
