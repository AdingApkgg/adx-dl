import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";

import { QqCodeForm } from "./qq-code-form";

describe("QqCodeForm", () => {
  // 登录页上这是唯一的输入框：浏览器要靠 autocomplete 里最后一个 webauthn 找到它，
  // 用户点它时列出本站的通行密钥（调研报告第 2.4 节）。
  test("登录页上 QQ 号输入框带 username webauthn；拿到人机验证令牌之前不能发码", () => {
    const html = renderToStaticMarkup(<QqCodeForm siteKey="site" intent="login" webauthnAutofill onVerified={() => {}} />);

    // React 服务端渲染把属性写成 autoComplete；HTML 属性名不分大小写，浏览器解析后是同一个属性。
    expect(html).toMatch(/autocomplete="username webauthn"/i);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  test("绑定 QQ 时不接管通行密钥的自动填充", () => {
    const html = renderToStaticMarkup(<QqCodeForm siteKey="site" intent="link" onVerified={() => {}} />);

    expect(html).not.toContain("webauthn");
  });
});
