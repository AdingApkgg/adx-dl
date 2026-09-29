import { describe, expect, test } from "bun:test";

import { loginHref } from "./require-user";

describe("loginHref", () => {
  test("带上 next；额外参数一并编码", () => {
    expect(loginHref("/settings/account")).toBe("/login?next=%2Fsettings%2Faccount");
    expect(loginHref("/settings/account", { reauth: "1" })).toBe("/login?next=%2Fsettings%2Faccount&reauth=1");
  });
});
