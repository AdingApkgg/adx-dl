import { App, Octokit as OctokitCtor } from "octokit";

import type { RepoInfo, RunDetail, RunSummary, WorkflowSummary } from "@/shared/dto";

import { GitHubRequestError, type GitHubClient } from "./client";

export type OctokitClientConfig = {
  appId: string;
  privateKey: string;
  installationId: number;
  owner: string;
  repo: string;
};

// 不用 `Awaited<ReturnType<App["getInstallationOctokit"]>>`：octokit@5.0.5 里
// `App` 的类型是「显式大对象构造签名」与「@octokit/app 的泛型 App 类」两个构造签名的
// 交叉类型，`InstanceType` 对交叉的构造签名取的是后一个（泛型、默认 TOptions），
// 结果丢了 rest/paginate/retry —— 用 tsc 的 TypeChecker 实测验证过。
// `App` 内部用同一个 `Octokit` 类构造实例（dist-src/app.js: `DefaultApp.defaults({ Octokit })`），
// 所以直接从这个类取实例类型，运行时形状与类型完全一致。
type Octokit = InstanceType<typeof OctokitCtor>;

/** 把 octokit 抛出来的任意错误收敛成我们自己的错误类型。 */
function toRequestError(error: unknown): GitHubRequestError {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    const message = error instanceof Error ? error.message : String(error);
    return new GitHubRequestError(message, typeof status === "number" ? status : null);
  }
  return new GitHubRequestError(error instanceof Error ? error.message : String(error), null);
}

type RawRun = {
  id: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  event: string;
  head_branch?: string | null;
  head_sha: string;
  created_at: string;
  updated_at: string;
  run_number: number;
  html_url: string;
};

/** GitHub 的 snake_case 到我们 DTO 的 camelCase 的唯一转换点。 */
function toRunSummary(raw: RawRun): RunSummary {
  return {
    id: raw.id,
    name: raw.name ?? "(unnamed)",
    status: (raw.status ?? "queued") as RunSummary["status"],
    conclusion: (raw.conclusion ?? null) as RunSummary["conclusion"],
    event: raw.event,
    branch: raw.head_branch ?? "",
    sha: raw.head_sha,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    runNumber: raw.run_number,
    htmlUrl: raw.html_url,
  };
}

export function createOctokitGitHubClient(config: OctokitClientConfig): GitHubClient {
  const app = new App({ appId: config.appId, privateKey: config.privateKey });

  // 缓存的是 octokit 实例，不是 token —— token 的换取、缓存与到期刷新
  // 由 @octokit/auth-app 在实例内部处理，我们不重复造一份会过期的状态。
  let cached: Promise<Octokit> | null = null;
  const octokit = () => {
    cached ??= app.getInstallationOctokit(config.installationId);
    return cached;
  };

  // 每个方法都要「拿实例 → 调用 → 失败时清缓存并抛出统一错误」，七个方法
  // 手抄七遍这段样板迟早漏掉一次 `cached = null`，那个方法就悄悄退出了
  // 缓存恢复机制——认证失败一次，就把进程钉在坏实例上直到重启。
  // 这里收成一个包装：调用方只管拿到 kit 之后要做什么。
  async function withOctokit<T>(fn: (kit: Octokit) => Promise<T>): Promise<T> {
    try {
      const kit = await octokit();
      return await fn(kit);
    } catch (error) {
      cached = null;
      throw toRequestError(error);
    }
  }

  return {
    async getRepoInfo(): Promise<RepoInfo> {
      return withOctokit(async (kit) => {
        const { data } = await kit.rest.repos.get({
          owner: config.owner,
          repo: config.repo,
        });
        return {
          owner: data.owner.login,
          repo: data.name,
          defaultBranch: data.default_branch,
        };
      });
    },

    async listWorkflows(): Promise<WorkflowSummary[]> {
      return withOctokit(async (kit) => {
        const { data } = await kit.rest.actions.listRepoWorkflows({
          owner: config.owner,
          repo: config.repo,
          per_page: 100,
        });
        return data.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          path: w.path,
          state: w.state,
        }));
      });
    },

    async listRuns(opts?: { perPage?: number }): Promise<RunSummary[]> {
      return withOctokit(async (kit) => {
        const { data } = await kit.rest.actions.listWorkflowRunsForRepo({
          owner: config.owner,
          repo: config.repo,
          per_page: opts?.perPage ?? 30,
        });
        return data.workflow_runs.map(toRunSummary);
      });
    },

    async getRun(runId: number): Promise<RunDetail> {
      return withOctokit(async (kit) => {
        const [run, jobs] = await Promise.all([
          kit.rest.actions.getWorkflowRun({
            owner: config.owner,
            repo: config.repo,
            run_id: runId,
          }),
          kit.rest.actions.listJobsForWorkflowRun({
            owner: config.owner,
            repo: config.repo,
            run_id: runId,
            per_page: 100,
          }),
        ]);

        return {
          run: toRunSummary(run.data),
          jobs: jobs.data.jobs.map((job) => ({
            id: job.id,
            name: job.name,
            status: job.status,
            conclusion: job.conclusion ?? null,
            startedAt: job.started_at ?? null,
            completedAt: job.completed_at ?? null,
            steps: (job.steps ?? []).map((step) => ({
              name: step.name,
              status: step.status,
              conclusion: step.conclusion ?? null,
              number: step.number,
              startedAt: step.started_at ?? null,
              completedAt: step.completed_at ?? null,
            })),
          })),
        };
      });
    },
  };
}
