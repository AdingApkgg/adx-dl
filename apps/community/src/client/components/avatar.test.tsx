import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";

import { avatarColor } from "@/shared/avatar";

import { Avatar } from "./avatar";

describe("Avatar", () => {
  test("内联 SVG：背景色来自用户 id，中间是昵称的第一个字符，对读屏软件隐藏", () => {
    const html = renderToStaticMarkup(<Avatar id="abc2345678" name="阿丁" size={64} />);

    expect(html).toStartWith("<svg");
    expect(html).toContain('width="64"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`fill="${avatarColor("abc2345678")}"`);
    expect(html).toContain(">阿</text>");
  });

  // 昵称是用户写的：React 会转义，不会变成标签。
  test("昵称里的尖括号被转义", () => {
    const html = renderToStaticMarkup(<Avatar id="abc2345678" name="<script>" />);

    expect(html).toContain("&lt;</text>");
    expect(html).not.toContain("<script>");
  });
});
