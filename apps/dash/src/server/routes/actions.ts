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
}
