import { describe, expect, test } from "bun:test";

import { ApiError, expectOk } from "./api-client";

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  };
}

describe("expectOk", () => {
  test("成功的响应原样返回", async () => {
    const response = fakeResponse(200, { a: 1 });
    expect(await expectOk(response)).toBe(response);
  });

  test("错误响应抛出带 code 的 ApiError", async () => {
    const error = await expectOk(fakeResponse(429, { error: { code: "RATE_LIMITED", message: "Too many" } })).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", message: "Too many" });
  });

  test("响应体不是约定格式时用状态码兜底", async () => {
    const error = await expectOk(fakeResponse(502, "bad gateway")).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "HTTP_502" });
  });
});
