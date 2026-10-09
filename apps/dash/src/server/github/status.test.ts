import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";

import { GitHubRequestError } from "./client";
import { statusFor, withGitHubErrors } from "./status";

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

describe("withGitHubErrors", () => {
  test("HTTPException 原样放行——它已经是一个成形的响应", async () => {
    // 内容路由要在 withGitHubErrors 的包裹范围内抛两种已经拼好的响应：
    // 400「校验未通过」（带 errors 数组）和 409 冲突（带 step 与
    // conflictPaths）。再过一次 statusFor，它们会因为不是
    // GitHubRequestError 而被压成裸 502，body 里那些字段一个都留不下。
    const thrown = new HTTPException(400, {
      res: Response.json({ error: "校验未通过", errors: ["a: bad"] }, { status: 400 }),
    });
    const error = await withGitHubErrors(async () => {
      throw thrown;
    }).catch((e: unknown) => e);

    expect(error).toBe(thrown);
    const res = (error as HTTPException).getResponse();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "校验未通过", errors: ["a: bad"] });
  });

  test("其余错误照旧按 statusFor 收敛成 HTTPException", async () => {
    // 上面那条早退不能顺手把「收敛」这件事一起短路掉——这条守的就是它。
    const error = await withGitHubErrors(async () => {
      throw new GitHubRequestError("run not found", 404);
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HTTPException);
    const res = (error as HTTPException).getResponse();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "run not found" });
  });
});
