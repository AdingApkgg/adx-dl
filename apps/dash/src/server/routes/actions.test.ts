import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { RunDetail, RunSummary, WorkflowSummary } from "@/shared/dto";

import { createFakeGitHubClient } from "../github/fake-client";
import type { AccessVariables } from "../middleware/access-jwt";
import { registerActionsRoutes } from "./actions";

function makeApp(github = createFakeGitHubClient()) {
  const app = new Hono<{ Variables: AccessVariables }>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: "someone@example.com", sub: "user-1" });
    await next();
  });
  registerActionsRoutes(app, { github });
  return app;
}

describe("GET /api/workflows", () => {
  test("列出工作流", async () => {
    const res = await makeApp().request("/api/workflows");

    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkflowSummary[];
    expect(body).toHaveLength(2);
    expect(body[0].path).toBe(".github/workflows/deploy-gh-pages.yml");
  });
});

describe("GET /api/runs", () => {
  test("列出 run", async () => {
    const res = await makeApp().request("/api/runs");

    expect(res.status).toBe(200);
    const body = (await res.json()) as RunSummary[];
    expect(body).toHaveLength(2);
    expect(body.map((r) => r.id)).toEqual([1001, 1002]);
  });

  test("perPage 透传给客户端且有上限", async () => {
    const github = createFakeGitHubClient();
    const calls: (number | undefined)[] = [];
    const original = github.listRuns.bind(github);
    github.listRuns = async (opts) => {
      calls.push(opts?.perPage);
      return original(opts);
    };

    await makeApp(github).request("/api/runs?perPage=5");
    await makeApp(github).request("/api/runs?perPage=999");
    await makeApp(github).request("/api/runs?perPage=abc");

    // 上限 100 是 GitHub 的分页上限；超了会被它直接拒，不如在这里夹住。
    // 非数字回落到默认值，而不是把 NaN 送出去。
    expect(calls).toEqual([5, 100, 30]);
  });
});

describe("GET /api/runs/:runId", () => {
  test("返回 run 与它的 job/step", async () => {
    const res = await makeApp().request("/api/runs/1001");

    expect(res.status).toBe(200);
    const body = (await res.json()) as RunDetail;
    expect(body.run.id).toBe(1001);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].steps.map((s) => s.name)).toEqual(["Build catalog", "Build site"]);
  });

  test("不存在的 run：404", async () => {
    const res = await makeApp().request("/api/runs/999999");

    expect(res.status).toBe(404);
  });

  test("runId 不是数字：400，不去打 GitHub", async () => {
    const github = createFakeGitHubClient();
    let called = false;
    github.getRun = async () => {
      called = true;
      throw new Error("不该被调用");
    };

    const res = await makeApp(github).request("/api/runs/not-a-number");

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});
