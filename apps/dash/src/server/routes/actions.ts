import type { Hono } from "hono";

import type { GitHubClient } from "../github/client";
import { withGitHubErrors } from "../github/status";
import type { AccessVariables } from "../middleware/access-jwt";

export type ActionsDeps = {
  github: GitHubClient;
};

const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100; // GitHub 分页上限，超了它会直接拒。

function parsePerPage(raw: string | undefined): number {
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 1) return DEFAULT_PER_PAGE;
  return Math.min(value, MAX_PER_PAGE);
}

export function registerActionsRoutes(
  app: Hono<{ Variables: AccessVariables }>,
  deps: ActionsDeps
) {
  app.get("/api/workflows", async (c) => {
    return c.json(await withGitHubErrors(() => deps.github.listWorkflows()));
  });

  // 喂 Actions 页的分支选择器（Change 4）——没有它，dispatch 永远只能打
  // 仓库默认分支，dev → pre → main 的模型里这是个真实限制。
  app.get("/api/branches", async (c) => {
    return c.json(await withGitHubErrors(() => deps.github.listBranches()));
  });

  app.get("/api/runs", async (c) => {
    const perPage = parsePerPage(c.req.query("perPage"));
    return c.json(await withGitHubErrors(() => deps.github.listRuns({ perPage })));
  });

  app.get("/api/runs/:runId", async (c) => {
    const runId = Number(c.req.param("runId"));
    // 先挡住非数字，别让 "not-a-number" 变成 NaN 一路打到 GitHub 换一个
    // 看不懂的 422 回来。
    if (!Number.isInteger(runId)) {
      return c.json({ error: "runId 必须是整数" }, 400);
    }

    return c.json(await withGitHubErrors(() => deps.github.getRun(runId)));
  });

  app.post("/api/workflows/:workflowId/dispatch", async (c) => {
    const workflowId = Number(c.req.param("workflowId"));
    if (!Number.isInteger(workflowId)) {
      return c.json({ error: "workflowId 必须是整数" }, 400);
    }

    // 请求体可有可无：没有就用仓库默认分支。
    let ref: string | undefined;
    try {
      const body = (await c.req.json()) as { ref?: unknown };
      if (typeof body.ref === "string" && body.ref.trim()) ref = body.ref.trim();
    } catch {
      // 空 body 或非 JSON —— 用默认分支，不是错误。
    }

    const target = ref ?? (await withGitHubErrors(() => deps.github.getRepoInfo())).defaultBranch;
    await withGitHubErrors(() => deps.github.dispatchWorkflow(workflowId, target));
    // 202：GitHub 收下了，但 run 还没出现在列表里，前端要靠轮询等它。
    return c.json({ accepted: true, ref: target }, 202);
  });

  const runAction = (path: string, perform: (runId: number) => Promise<void>) => {
    app.post(path, async (c) => {
      const runId = Number(c.req.param("runId"));
      if (!Number.isInteger(runId)) {
        return c.json({ error: "runId 必须是整数" }, 400);
      }
      await withGitHubErrors(() => perform(runId));
      return c.json({ accepted: true }, 202);
    });
  };

  runAction("/api/runs/:runId/rerun", (runId) => deps.github.rerunRun(runId));
  runAction("/api/runs/:runId/cancel", (runId) => deps.github.cancelRun(runId));

  app.get("/api/runs/:runId/failure-log", async (c) => {
    const runId = Number(c.req.param("runId"));
    if (!Number.isInteger(runId)) {
      return c.json({ error: "runId 必须是整数" }, 400);
    }

    const log = await withGitHubErrors(() => deps.github.getFailedStepLog(runId));
    // 没有失败步骤是正常结果，不是错误 —— 204 让前端不必去分辨
    // 「空数组」和「查不到」。
    if (!log) return c.body(null, 204);
    return c.json(log);
  });
}
