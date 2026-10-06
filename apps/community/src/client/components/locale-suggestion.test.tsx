import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter } from "react-router";

import { LocaleSuggestion } from "./locale-suggestion";

// 服务端不知道浏览器的语言偏好：提示条只在浏览器里、页面加载完以后才决定要不要出现，服务端渲染什么都不输出，
// hydrate 前后才一致。
describe("浏览器语言不一致提示", () => {
  test("服务端渲染：什么都不输出", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <LocaleSuggestion />
      </MemoryRouter>
    );

    expect(html).toBe("");
  });
});
