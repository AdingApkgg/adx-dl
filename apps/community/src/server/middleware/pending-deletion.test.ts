import { describe, expect, test } from "bun:test";

import { isAllowedWhilePending } from "./pending-deletion";

describe("isAllowedWhilePending", () => {
  test("放行：取当前用户、撤销注销、公开接口；HEAD 和 GET 一样", () => {
    for (const [method, path] of [
      ["GET", "/api/v1/me"],
      ["HEAD", "/api/v1/me"],
      ["DELETE", "/api/v1/me/deletion"],
      ["GET", "/api/v1/meta"],
      ["GET", "/api/v1/login-options"],
      ["GET", "/api/v1/users/abc2345678"],
    ] as const) {
      expect(isAllowedWhilePending(method, path), `${method} ${path}`).toBe(true);
    }
  });

  test("其余一律不放行：路径多一段、方法不对都不算", () => {
    for (const [method, path] of [
      ["GET", "/api/v1/me/profile"],
      ["PATCH", "/api/v1/me/profile"],
      ["GET", "/api/v1/me/logins"],
      ["POST", "/api/v1/me/deletion"],
      ["DELETE", "/api/v1/me"],
      ["GET", "/api/v1/me/"],
      ["GET", "/api/v1/users/abc2345678/extra"],
      ["POST", "/api/v1/meta"],
    ] as const) {
      expect(isAllowedWhilePending(method, path), `${method} ${path}`).toBe(false);
    }
  });
});
