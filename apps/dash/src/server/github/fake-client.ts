import type {
  BranchSummary,
  FailedStepLog,
  RepoInfo,
  RunDetail,
  RunJob,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

import { GitHubRequestError, type GitHubClient } from "./client";

export type FakeSeed = {
  repo: RepoInfo;
  /** 设为非 null 时，getRepoInfo 抛这个错，用来测连不通的分支。 */
  repoError: GitHubRequestError | null;
  workflows: WorkflowSummary[];
  branches: BranchSummary[];
  runs: RunSummary[];
  /** 按 runId 索引的 job 列表。没有条目的 run 视为「没有 job」。 */
  jobs: Record<number, RunJob[]>;
  /** 记录 dispatchWorkflow 的调用。 */
  dispatched: { workflowId: number; ref: string }[];
  /** 记录 rerunRun 的调用。 */
  rerun: number[];
  /** 记录 cancelRun 的调用。 */
  cancelled: number[];
  /** 按 runId 索引的失败日志；没有条目表示该 run 没有失败步骤。 */
  failureLogs: Record<number, FailedStepLog>;
};

// 工厂函数而不是模块级常量：`dispatched`/`rerun`/`cancelled` 会被写操作的假
// 实现 push 进去，如果 defaultSeed 是个单例对象，`{ ...defaultSeed, ...seed }`
// 只做浅拷贝，这几个数组的引用会被所有没有显式覆盖它们的测试共用——一个测试
// 触发的 dispatch 会污染另一个测试看到的 seed.dispatched。每次调用都造一份
// 新对象，数组各自独立。
function createDefaultSeed(): FakeSeed {
  return {
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
    // dev → pre → main：仓库真实的分支模型（见 Change 4 的分支选择器）。
    branches: [
      { name: "main", protected: true },
      { name: "pre", protected: false },
      { name: "dev", protected: false },
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
    dispatched: [],
    rerun: [],
    cancelled: [],
    failureLogs: {},
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
}

export function createFakeGitHubClient(seed: Partial<FakeSeed> = {}) {
  const state: FakeSeed = { ...createDefaultSeed(), ...seed };

  const client: GitHubClient & { seed: FakeSeed } = {
    seed: state,

    async getRepoInfo() {
      if (state.repoError) throw state.repoError;
      return state.repo;
    },

    async listWorkflows() {
      return state.workflows;
    },

    async listBranches() {
      return state.branches;
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

    async dispatchWorkflow(workflowId, ref) {
      state.dispatched.push({ workflowId, ref });
    },

    async rerunRun(runId) {
      state.rerun.push(runId);
    },

    async cancelRun(runId) {
      state.cancelled.push(runId);
    },

    async getFailedStepLog(runId) {
      return state.failureLogs[runId] ?? null;
    },
  };

  return client;
}
