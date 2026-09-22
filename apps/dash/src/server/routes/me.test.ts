import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { MeResponse } from "@/shared/dto";

import { GitHubRequestError } from "../github/client";
import { createFakeRepoClient } from "../github/fake-client";
import type { AccessVariables } from "../middleware/access-jwt";
import { registerMeRoute } from "./me";

/** 绕开 Access 中间件，直接把身份塞进 context，只测路由本身。
 *  `registerMeRoute` 只依赖 RepoClient（见 me.ts 的 MeDeps），所以这里
 *  用只覆盖仓库元数据领域的 createFakeRepoClient，不用连带种一份
 *  Actions 数据。 */
function makeApp(github = createFakeRepoClient()) {
  const app = new Hono<{ Variables: AccessVariables }>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: "someone@example.com", sub: "user-1" });
    await next();
  });
  registerMeRoute(app, { github });
  return app;
}

describe("GET /api/me", () => {
  test("连得通时返回身份与仓库信息", async () => {
    const res = await makeApp().request("/api/me");

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body).toEqual({
      email: "someone@example.com",
      repo: { owner: "AdingApkgg", repo: "adx-dl", defaultBranch: "main" },
      repoError: null,
    });
  });

  test("App 连不通时仍返回 200，把错误放进 repoError", async () => {
    // 这是刻意的：/api/me 是连通性自检页面的数据源，它自己不能因为
    // 「被检查的东西坏了」而挂掉，否则界面只会白屏，看不到原因。
    const github = createFakeRepoClient({
      repoError: new GitHubRequestError("Bad credentials", 401),
    });

    const res = await makeApp(github).request("/api/me");

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.email).toBe("someone@example.com");
    expect(body.repo).toBeNull();
    expect(body.repoError).toContain("Bad credentials");
  });
});
