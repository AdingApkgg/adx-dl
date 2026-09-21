import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { RunDetail, RunSummary, WorkflowSummary } from "@/shared/dto";

import { GitHubRequestError } from "../github/client";
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

describe("POST /api/workflows/:workflowId/dispatch", () => {
  test("触发工作流，默认用仓库默认分支", async () => {
    const github = createFakeGitHubClient();
    const res = await makeApp(github).request("/api/workflows/1/dispatch", { method: "POST" });

    expect(res.status).toBe(202);
    expect(github.seed.dispatched).toEqual([{ workflowId: 1, ref: "main" }]);
  });

  test("可以指定 ref", async () => {
    const github = createFakeGitHubClient();
    await makeApp(github).request("/api/workflows/1/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "some-branch" }),
    });

    expect(github.seed.dispatched).toEqual([{ workflowId: 1, ref: "some-branch" }]);
  });

  test("GET 不能触发", async () => {
    // 触发部署是有副作用的操作，绝不能被一个 GET 触发 —— 预加载、
    // 爬虫、甚至浏览器的地址栏补全都会发 GET。
    const github = createFakeGitHubClient();
    const res = await makeApp(github).request("/api/workflows/1/dispatch");

    expect(res.status).not.toBe(202);
    expect(github.seed.dispatched).toEqual([]);
  });
});

describe("POST /api/runs/:runId/rerun 与 /cancel", () => {
  test("重跑", async () => {
    const github = createFakeGitHubClient();
    const res = await makeApp(github).request("/api/runs/1001/rerun", { method: "POST" });

    expect(res.status).toBe(202);
    expect(github.seed.rerun).toEqual([1001]);
  });

  test("取消", async () => {
    const github = createFakeGitHubClient();
    const res = await makeApp(github).request("/api/runs/1002/cancel", { method: "POST" });

    expect(res.status).toBe(202);
    expect(github.seed.cancelled).toEqual([1002]);
  });

  test("runId 非数字：400", async () => {
    const res = await makeApp().request("/api/runs/abc/rerun", { method: "POST" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/runs/:runId/failure-log", () => {
  test("返回失败步骤的日志尾部", async () => {
    const github = createFakeGitHubClient({
      failureLogs: {
        1003: { jobName: "deploy", stepName: "Typecheck and test", lines: ["error TS2345", "1 error"] },
      },
    });

    const res = await makeApp(github).request("/api/runs/1003/failure-log");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jobName: "deploy",
      stepName: "Typecheck and test",
      lines: ["error TS2345", "1 error"],
    });
  });

  test("没有失败步骤时返回 204", async () => {
    const res = await makeApp().request("/api/runs/1001/failure-log");

    expect(res.status).toBe(204);
  });
});

describe("statusFor 的状态码映射", () => {
  test("上游 409（例如取消一个已经跑完的 run）：原样传给客户端", async () => {
    const github = createFakeGitHubClient();
    github.cancelRun = async () => {
      throw new GitHubRequestError("run already completed", 409);
    };

    const res = await makeApp(github).request("/api/runs/1001/cancel", { method: "POST" });

    expect(res.status).toBe(409);
  });

  test("上游 422（例如 workflow 没有 workflow_dispatch 触发器）：原样传给客户端", async () => {
    const github = createFakeGitHubClient();
    github.dispatchWorkflow = async () => {
      throw new GitHubRequestError("no workflow_dispatch trigger configured", 422);
    };

    const res = await makeApp(github).request("/api/workflows/1/dispatch", { method: "POST" });

    expect(res.status).toBe(422);
  });

  test("上游 403 不原样传——会跟 Access 中间件自己的 403 撞车，统一按 502 处理，body 也不冒充 Access 的拒绝", async () => {
    const github = createFakeGitHubClient();
    github.rerunRun = async () => {
      throw new GitHubRequestError("installation token revoked", 403);
    };

    const res = await makeApp(github).request("/api/runs/1001/rerun", { method: "POST" });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    // 不能是 accessJwt 中间件用的那句话——那样客户端就分不清是
    // 「Access 会话过期」还是「GitHub 这边的凭证出问题了」。
    expect(body.error).not.toBe("Access 断言无效");
  });

  test("上游 500：按 502 处理", async () => {
    const github = createFakeGitHubClient();
    github.cancelRun = async () => {
      throw new GitHubRequestError("internal server error", 500);
    };

    const res = await makeApp(github).request("/api/runs/1001/cancel", { method: "POST" });

    expect(res.status).toBe(502);
  });

  test("上游 404：保留既有行为，原样传给客户端", async () => {
    const github = createFakeGitHubClient();
    github.getFailedStepLog = async () => {
      throw new GitHubRequestError("run not found", 404);
    };

    const res = await makeApp(github).request("/api/runs/999999/failure-log");

    expect(res.status).toBe(404);
  });
});
