import { describe, expect, test } from "bun:test";

import { m } from "@/paraglide/messages.js";
import { ApiError } from "@/shared/api-client";

import { errorCodeOf, errorMessage } from "./auth-errors";

describe("错误文案", () => {
  test("认得三种来源的错误码：Better Auth 客户端、我们的接口、地址里的 ?error=", () => {
    expect(errorCodeOf({ code: "QQ_CODE_INVALID", status: 400 })).toBe("QQ_CODE_INVALID");
    expect(errorCodeOf(new ApiError(403, "REAUTH_REQUIRED", "x"))).toBe("REAUTH_REQUIRED");
    expect(errorCodeOf("account_already_linked_to_different_user")).toBe("account_already_linked_to_different_user");
    expect(errorCodeOf(null)).toBeUndefined();
  });

  test("已知的错误码翻译成对应的文案", () => {
    expect(errorMessage({ code: "REAUTH_REQUIRED" })).toBe(m.error_reauth_required());
    expect(errorMessage({ code: "SESSION_NOT_FRESH" })).toBe(m.error_reauth_required());
    expect(errorMessage({ code: "SIGNUP_CAPTCHA_FAILED" })).toBe(m.error_captcha_failed());
    expect(errorMessage(new ApiError(400, "LAST_LOGIN_METHOD", "x"))).toBe(m.error_last_login_method());
    expect(errorMessage("account_already_linked_to_different_user")).toBe(m.error_google_already_linked());
  });

  // Better Auth 的 429 响应体没有 code（调研报告第 12 题）。
  test("没有错误码的 429 当作限流", () => {
    expect(errorMessage({ status: 429 })).toBe(m.error_rate_limited());
  });

  test("用户自己取消通行密钥对话框时不提示", () => {
    expect(errorMessage({ code: "AUTH_CANCELLED" })).toBeNull();
    expect(errorMessage({ code: "ERROR_CEREMONY_ABORTED" })).toBeNull();
    expect(errorMessage("access_denied")).toBeNull();
  });

  test("Google 回调的其他错误（小写的错误码）统一提示 Google 登录失败；其余不认识的用通用文案", () => {
    expect(errorMessage("state_mismatch")).toBe(m.error_google_failed());
    expect(errorMessage({ code: "SOMETHING_NEW" })).toBe(m.error_unknown());
  });
});
