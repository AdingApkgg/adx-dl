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

/**
 * 只透传「这次请求本身就不会成功、而且不会跟我们自己已经用来表达别的
 * 含义的状态码撞车」这几个：
 *   - 404：run/workflow 不存在。
 *   - 409：目标状态不允许这个操作（例如取消一个已经跑完的 run）。
 *   - 422：请求本身不合法（例如 workflow 没有 workflow_dispatch 触发器、
 *          ref 不存在）。
 * 这三个原样重试也不会变，前端/告警该按「这次操作本身有问题」处理，
 * 而不是「再点一次 / 再轮询一次」。其余一律按 502 处理。
 *
 * 故意不透传 401/403：accessJwt 中间件自己在鉴权失败时也回 403
 * （`{"error":"Access 断言无效"}`）。如果把 GitHub 的 401/403（安装
 * token 过期、权限被收回、二级限流……）原样传下去，客户端收到的 403
 * 会和「Access 会话过期」长得一模一样——运维会去重新登录 Cloudflare
 * Access，而真正的问题出在 GitHub App 这一侧，重新登录什么也解决不了。
 * 所以这两个状态码故意落进下面的默认分支，统一按 502：502 读起来是
 * 「服务器这边出问题了」，不会被误当成「你需要重新登录」。这是这里
 * 唯一反直觉、容易被后人当「化简」删掉的一行判断，别删。
 *
 * 429（GitHub 限流）也走默认的 502：它不会跟我们自己的哪个状态码撞车、
 * 不会被误解成别的意思，但它跟 409/422 不是一类——限流是暂时的，原样
 * 重试大概率会成功，语义上更接近「上游暂时顶不住了，稍后再试」，这正是
 * 502 已经在表达的意思。以后如果要做更精细的退避（比如读 Retry-After
 * 头），可以再单独拆出来，不算是现在这里漏掉的语义。
 */
function statusFor(error: unknown): 404 | 409 | 422 | 502 {
  if (error instanceof GitHubRequestError) {
    if (error.status === 404 || error.status === 409 || error.status === 422) {
      return error.status;
    }
  }
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
