import { describe, expect, test } from "bun:test";

import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  test("站内路径原样返回", () => {
    expect(safeNextPath("/settings/account")).toBe("/settings/account");
    expect(safeNextPath("/en/u/abc?tab=1")).toBe("/en/u/abc?tab=1");
  });

  // //evil.com、/\evil.com 在浏览器里都会被当成 https://evil.com（1a 评审的开放重定向）。
  test("外站、协议相对地址、带控制字符的地址都换成默认值", () => {
    for (const raw of ["https://evil.com", "//evil.com", "/\\evil.com", "evil.com", "/ok\u0000", "", null, undefined]) {
      expect(safeNextPath(raw), String(raw)).toBe("/");
    }
    expect(safeNextPath("//evil.com", "/settings/account")).toBe("/settings/account");
  });
});
