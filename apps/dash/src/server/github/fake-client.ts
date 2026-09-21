import type { RepoInfo, RunDetail, RunJob, RunSummary, WorkflowSummary } from "@/shared/dto";

import { GitHubRequestError, type GitHubClient } from "./client";

export type FakeSeed = {
  repo: RepoInfo;
  /** 设为非 null 时，getRepoInfo 抛这个错，用来测连不通的分支。 */
  repoError: GitHubRequestError | null;
  workflows: WorkflowSummary[];
  runs: RunSummary[];
  /** 按 runId 索引的 job 列表。没有条目的 run 视为「没有 job」。 */
  jobs: Record<number, RunJob[]>;
};

const defaultSeed: FakeSeed = {
  repo: { owner: "AdingApkgg", repo: "adx-dl", defaultBranch: "main" },
  repoError: null,
  workflows: [
    {
      id: 1,
      name: "Build and Publish gh-pages",
      path: ".github/workflows/deploy-gh-pages.yml",
      state: "active",
    },
    { id: 2, name: "Dash check", path: ".github/workflows/dash-check.yml", state: "active" },
  ],
  runs: [
    {
      id: 1001,
      name: "Build and Publish gh-pages",
      status: "completed",
      conclusion: "success",
      event: "push",
      branch: "main",
      sha: "a706bac",
      createdAt: "2026-09-20T10:00:00Z",
      updatedAt: "2026-09-20T10:06:00Z",
      runNumber: 95,
      htmlUrl: "https://github.com/AdingApkgg/adx-dl/actions/runs/1001",
    },
    {
      id: 1002,
      name: "Build and Publish gh-pages",
      status: "in_progress",
      conclusion: null,
      event: "workflow_dispatch",
      branch: "main",
      sha: "b810cde",
      createdAt: "2026-09-21T02:00:00Z",
      updatedAt: "2026-09-21T02:01:00Z",
      runNumber: 96,
      htmlUrl: "https://github.com/AdingApkgg/adx-dl/actions/runs/1002",
    },
  ],
  jobs: {
    1001: [
      {
        id: 5001,
        name: "deploy",
        status: "completed",
        conclusion: "success",
        startedAt: "2026-09-20T10:00:10Z",
        completedAt: "2026-09-20T10:06:00Z",
        steps: [
          {
            name: "Build catalog",
            status: "completed",
            conclusion: "success",
            number: 1,
            startedAt: "2026-09-20T10:00:10Z",
            completedAt: "2026-09-20T10:02:10Z",
          },
          {
            name: "Build site",
            status: "completed",
            conclusion: "success",
            number: 2,
            startedAt: "2026-09-20T10:02:10Z",
            completedAt: "2026-09-20T10:06:00Z",
          },
        ],
      },
    ],
  },
};

export function createFakeGitHubClient(seed: Partial<FakeSeed> = {}) {
  const state: FakeSeed = { ...defaultSeed, ...seed };

  const client: GitHubClient & { seed: FakeSeed } = {
    seed: state,

    async getRepoInfo() {
      if (state.repoError) throw state.repoError;
      return state.repo;
    },

    async listWorkflows() {
      return state.workflows;
    },

    async listRuns(opts) {
      const perPage = opts?.perPage ?? 30;
      return state.runs.slice(0, perPage);
    },

    async getRun(runId): Promise<RunDetail> {
      const run = state.runs.find((candidate) => candidate.id === runId);
      // 抛 404 而不是回 null：路由据此把状态码原样传下去，
      // 测试也就能覆盖「run 不存在」这条分支。
      if (!run) throw new GitHubRequestError("run not found", 404);
      return { run, jobs: state.jobs[runId] ?? [] };
    },
  };

  return client;
}
