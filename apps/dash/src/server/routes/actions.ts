import type { Hono } from "hono";

import type { GitHubClient } from "../github/client";
import { GitHubRequestError } from "../github/client";
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

/** 把 GitHubRequestError 的状态码原样传下去，其余按 502 处理。 */
function statusFor(error: unknown): 404 | 502 {
  if (error instanceof GitHubRequestError && error.status === 404) return 404;
  return 502;
}

export function registerActionsRoutes(
  app: Hono<{ Variables: AccessVariables }>,
  deps: ActionsDeps
) {
  app.get("/api/workflows", async (c) => {
    try {
      return c.json(await deps.github.listWorkflows());
    } catch (error) {
      return c.json({ error: String(error) }, statusFor(error));
    }
  });

  app.get("/api/runs", async (c) => {
    try {
      const perPage = parsePerPage(c.req.query("perPage"));
      return c.json(await deps.github.listRuns({ perPage }));
    } catch (error) {
      return c.json({ error: String(error) }, statusFor(error));
    }
  });

  app.get("/api/runs/:runId", async (c) => {
    const runId = Number(c.req.param("runId"));
    // 先挡住非数字，别让 "not-a-number" 变成 NaN 一路打到 GitHub 换一个
    // 看不懂的 422 回来。
    if (!Number.isInteger(runId)) {
      return c.json({ error: "runId 必须是整数" }, 400);
    }

    try {
      return c.json(await deps.github.getRun(runId));
    } catch (error) {
      return c.json({ error: String(error) }, statusFor(error));
    }
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

    try {
      const target = ref ?? (await deps.github.getRepoInfo()).defaultBranch;
      await deps.github.dispatchWorkflow(workflowId, target);
      // 202：GitHub 收下了，但 run 还没出现在列表里，前端要靠轮询等它。
      return c.json({ accepted: true, ref: target }, 202);
    } catch (error) {
      return c.json({ error: String(error) }, statusFor(error));
    }
  });

  const runAction = (path: string, perform: (runId: number) => Promise<void>) => {
    app.post(path, async (c) => {
      const runId = Number(c.req.param("runId"));
      if (!Number.isInteger(runId)) {
        return c.json({ error: "runId 必须是整数" }, 400);
      }
      try {
        await perform(runId);
        return c.json({ accepted: true }, 202);
      } catch (error) {
        return c.json({ error: String(error) }, statusFor(error));
      }
    });
  };

  runAction("/api/runs/:runId/rerun", (runId) => deps.github.rerunRun(runId));
  runAction("/api/runs/:runId/cancel", (runId) => deps.github.cancelRun(runId));

  app.get("/api/runs/:runId/failure-log", async (c) => {
    const runId = Number(c.req.param("runId"));
    if (!Number.isInteger(runId)) {
      return c.json({ error: "runId 必须是整数" }, 400);
    }

    try {
      const log = await deps.github.getFailedStepLog(runId);
      // 没有失败步骤是正常结果，不是错误 —— 204 让前端不必去分辨
      // 「空数组」和「查不到」。
      if (!log) return c.body(null, 204);
      return c.json(log);
    } catch (error) {
      return c.json({ error: String(error) }, statusFor(error));
    }
  });
}
