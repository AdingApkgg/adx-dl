import { describe, expect, test } from "bun:test";

import { GitHubRequestError } from "./client";
import { statusFor } from "./status";

describe("statusFor", () => {
  test("404/409/422 原样透传", () => {
    expect(statusFor(new GitHubRequestError("run not found", 404))).toBe(404);
    expect(statusFor(new GitHubRequestError("run already completed", 409))).toBe(409);
    expect(statusFor(new GitHubRequestError("no workflow_dispatch trigger configured", 422))).toBe(422);
  });

  test("401/403 不原样透传——会跟 accessJwt 中间件自己的 403 撞车，统一按 502", () => {
    // 别删这条：它是这个函数里唯一反直觉的分支。
    expect(statusFor(new GitHubRequestError("Bad credentials", 401))).toBe(502);
    expect(statusFor(new GitHubRequestError("installation token revoked", 403))).toBe(502);
  });

  test("429（限流）按 502", () => {
    expect(statusFor(new GitHubRequestError("rate limited", 429))).toBe(502);
  });

  test("其他任意状态码（500 等）按 502", () => {
    expect(statusFor(new GitHubRequestError("internal server error", 500))).toBe(502);
  });

  test("status 为 null 的 GitHubRequestError 按 502", () => {
    expect(statusFor(new GitHubRequestError("network blip", null))).toBe(502);
  });

  test("非 GitHubRequestError 的任意错误按 502", () => {
    expect(statusFor(new Error("boom"))).toBe(502);
    expect(statusFor("not even an error")).toBe(502);
    expect(statusFor(undefined)).toBe(502);
  });
});
