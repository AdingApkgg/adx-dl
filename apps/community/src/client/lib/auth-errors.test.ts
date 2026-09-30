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

  test("1c 的错误码：资料、注销", () => {
    expect(errorMessage(new ApiError(400, "NICKNAME_INVALID", "x"))).toBe(m.error_nickname_invalid());
    expect(errorMessage(new ApiError(400, "BIO_TOO_LONG", "x"))).toBe(m.error_bio_too_long());
    expect(errorMessage({ code: "ACCOUNT_PENDING_DELETION", status: 403 })).toBe(m.error_account_pending_deletion());
    expect(errorMessage(new ApiError(400, "DELETION_CONFIRM_MISMATCH", "x"))).toBe(m.error_deletion_confirm_mismatch());
    expect(errorMessage(new ApiError(409, "DELETION_NOT_CANCELLABLE", "x"))).toBe(m.error_deletion_not_cancellable());
  });

  // Better Auth 的 429 响应体没有 code（调研报告第 12 题）。
  test("没有错误码的 429 当作限流", () => {
    expect(errorMessage({ status: 429 })).toBe(m.error_rate_limited());
  });

  test("用户自己取消通行密钥对话框时不提示", () => {
    expect(errorMessage({ code: "AUTH_CANCELLED" })).toBeNull();
    expect(errorMessage({ code: "ERROR_CEREMONY_ABORTED" })).toBeNull();
    // 点"取消"、超时、浏览器不允许时，@simplewebauthn/browser 抛出的是 NotAllowedError，
    // 通行密钥客户端原样交出它的错误码（signIn.passkey 和 addPasskey 都是）。
    expect(errorMessage({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", status: 400 })).toBeNull();
    expect(errorMessage("access_denied")).toBeNull();
  });

  test("Google 回调的其他错误（小写的错误码）统一提示 Google 登录失败；其余不认识的用通用文案", () => {
    expect(errorMessage("state_mismatch")).toBe(m.error_google_failed());
    expect(errorMessage({ code: "SOMETHING_NEW" })).toBe(m.error_unknown());
  });
});

// ?error= 来自地址，不可信：它可以是 Object.prototype 上的属性名。查表只能认自己的键，否则
// constructor 会得到一个对象（React 渲染不了），__proto__、hasOwnProperty、valueOf 会直接抛错，
// 一个构造出来的 /login?error=__proto__ 链接就能让登录页渲染崩掉。
describe("错误码是 Object.prototype 上的属性名", () => {
  // 全是小写字母和下划线的走 Google 回调那一支，其余的走通用文案。
  const cases: [string, () => string][] = [
    ["constructor", m.error_google_failed],
    ["__proto__", m.error_google_failed],
    ["toString", m.error_unknown],
    ["hasOwnProperty", m.error_unknown],
    ["valueOf", m.error_unknown],
  ];

  for (const [code, expected] of cases) {
    test(code, () => {
      expect(errorMessage(code)).toBe(expected());
      // Better Auth 客户端的 { code } 走的是同一个查表。
      expect(errorMessage({ code })).toBe(expected());
    });
  }

  test("Object.prototype 上的每个属性名都不会抛错，也总是得到一句字符串", () => {
    for (const code of Object.getOwnPropertyNames(Object.prototype)) {
      expect(typeof errorMessage(code), code).toBe("string");
    }
  });
});
