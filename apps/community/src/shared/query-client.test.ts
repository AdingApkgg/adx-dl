import { describe, expect, test } from "bun:test";

import { ApiError } from "./api-client";
import { makeQueryClient, shouldRetry } from "./query-client";

describe("shouldRetry", () => {
  test("4xx 不重试：再请求一次结果也一样", () => {
    expect(shouldRetry(0, new ApiError(404, "NOT_FOUND", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, "RATE_LIMITED", "x"))).toBe(false);
  });

  test("其他错误重试 1 次", () => {
    expect(shouldRetry(0, new ApiError(503, "HTTP_503", "x"))).toBe(true);
    expect(shouldRetry(0, new Error("network"))).toBe(true);
    expect(shouldRetry(1, new Error("network"))).toBe(false);
  });
});

describe("makeQueryClient", () => {
  test("默认 30 秒内视为新鲜，改数据的操作不重试", () => {
    const options = makeQueryClient().getDefaultOptions();
    expect(options.queries?.staleTime).toBe(30_000);
    expect(options.mutations?.retry).toBe(false);
  });
});
