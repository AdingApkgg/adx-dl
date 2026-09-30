import { describe, expect, test } from "bun:test";

import { ApiError } from "@/shared/api-client";

import { accountErrorRedirect } from "./account-errors";
import { loginHref } from "./require-user";

describe("accountErrorRedirect", () => {
  test("账号正在注销：去注销提示页（我们的接口和 Better Auth 的错误都认）", () => {
    expect(accountErrorRedirect(new ApiError(403, "ACCOUNT_PENDING_DELETION", "x"), "/settings/profile")).toBe(
      "/account-deletion"
    );
    expect(accountErrorRedirect({ code: "ACCOUNT_PENDING_DELETION", status: 403 }, "/settings/account")).toBe(
      "/account-deletion"
    );
  });

  test("未登录：去登录页，登录后回到原来的地址", () => {
    expect(accountErrorRedirect(new ApiError(401, "UNAUTHORIZED", "x"), "/settings/profile")).toBe(
      loginHref("/settings/profile")
    );
    expect(accountErrorRedirect({ status: 401 }, "/settings/account?tab=1")).toBe(loginHref("/settings/account?tab=1"));
  });

  test("别的错误不跳，由页面自己提示", () => {
    expect(accountErrorRedirect(new ApiError(403, "REAUTH_REQUIRED", "x"), "/")).toBeNull();
    expect(accountErrorRedirect({ code: "LAST_LOGIN_METHOD", status: 400 }, "/")).toBeNull();
    expect(accountErrorRedirect(null, "/")).toBeNull();
  });
});
