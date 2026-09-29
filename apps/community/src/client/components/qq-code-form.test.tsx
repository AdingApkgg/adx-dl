import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";

import { ApiError } from "@/shared/api-client";

import { isReauthError, QqCodeForm } from "./qq-code-form";

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

// 决定错误提示后面要不要给"重新登录"的链接。渲染出来的错误状态静态标记测不到（没有 DOM 测试环境），
// 所以判断本身单独测。
describe("isReauthError", () => {
  test("REAUTH_REQUIRED 和 SESSION_NOT_FRESH 是；Better Auth 的 { code } 和我们接口的 ApiError 都认", () => {
    expect(isReauthError({ code: "REAUTH_REQUIRED", message: "Sign in again to continue", status: 403 })).toBe(true);
    expect(isReauthError({ code: "SESSION_NOT_FRESH", status: 403 })).toBe(true);
    expect(isReauthError(new ApiError(403, "REAUTH_REQUIRED", "Sign in again to continue"))).toBe(true);
  });

  test("其他错误码、没有错误码的错误（比如网络错误）、undefined 都不是", () => {
    expect(isReauthError({ code: "QQ_CODE_INVALID", status: 400 })).toBe(false);
    expect(isReauthError({ code: "UNAUTHORIZED", status: 401 })).toBe(false);
    expect(isReauthError({ status: 500, statusText: "Fetch Error" })).toBe(false);
    expect(isReauthError(new ApiError(500, "INTERNAL", "boom"))).toBe(false);
    expect(isReauthError(undefined)).toBe(false);
    expect(isReauthError(null)).toBe(false);
  });
});
