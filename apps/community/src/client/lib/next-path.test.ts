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

  // 浏览器解析网址时会把制表符、换行、回车整个删掉，所以 /<tab>/evil.com 会变成 //evil.com。
  test("夹着制表符、换行、回车的协议相对地址也换成默认值", () => {
    for (const raw of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com"]) {
      // 先确认这几个地址真的会把人带出本站，测试才有意义。
      expect(new URL(raw, "https://x.test").origin, JSON.stringify(raw)).toBe("https://evil.com");
      expect(safeNextPath(raw), JSON.stringify(raw)).toBe("/");
    }
  });
});
