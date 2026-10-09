import type {
  BranchSummary,
  FailedStepLog,
  RepoInfo,
  RunDetail,
  RunJob,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

import {
  GitDataStepError,
  GitHubRequestError,
  type ActionsClient,
  type CommitFilesInput,
  type ContentClient,
  type GitHubClient,
  type RepoClient,
} from "./client";

export type RepoSeed = {
  repo: RepoInfo;
  /** 设为非 null 时，getRepoInfo 抛这个错，用来测连不通的分支。 */
  repoError: GitHubRequestError | null;
  branches: BranchSummary[];
};

export type ActionsSeed = {
  workflows: WorkflowSummary[];
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

export type ContentSeed = {
  /** 路径 → 正文。sha 由下面的 shaOf 算，测试不用自己编。 */
  files: Record<string, string>;
  /** 设为非 null 时 commitFiles 抛这个错，用来测路由的错误分支。 */
  commitError: Error | null;
  /** 记录每次 commitFiles 的入参，供断言。 */
  commits: CommitFilesInput[];
};

/**
 * 几个领域种子的合并——`createFakeGitHubClient` 的种子形状，跟拆分之前的
 * `FakeSeed` 逐字段一致（只是现在由 RepoSeed/ActionsSeed/ContentSeed 拼
 * 出来），已有测试传的 `Partial<FakeSeed>`（比如只给 `{ runs: [...] }` 或
 * `{ repoError: ... }`）不需要跟着改。
 */
export type FakeSeed = RepoSeed & ActionsSeed & ContentSeed;

// 工厂函数而不是模块级常量：`dispatched`/`rerun`/`cancelled` 会被写操作的假
// 实现 push 进去，如果 defaultSeed 是个单例对象，`{ ...defaultSeed, ...seed }`
// 只做浅拷贝，这几个数组的引用会被所有没有显式覆盖它们的测试共用——一个测试
// 触发的 dispatch 会污染另一个测试看到的 seed.dispatched。每次调用都造一份
// 新对象，数组各自独立。按领域拆成两个工厂，好让 createFakeRepoClient/
// createFakeActionsClient 分别只取自己那一半的默认值。
function createDefaultRepoSeed(): RepoSeed {
  return {
    repo: { owner: "AdingApkgg", repo: "adx-dl", defaultBranch: "main" },
    repoError: null,
    // dev → pre → main：仓库真实的分支模型（见 Change 4 的分支选择器）。
    branches: [
      { name: "main", protected: true },
      { name: "pre", protected: false },
      { name: "dev", protected: false },
    ],
  };
}

function createDefaultActionsSeed(): ActionsSeed {
  return {
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

/**
 * 内容领域的默认种子。路径取的是 content-schema 注册表里真实的那三个文件
 * （不是编出来的路径），正文是形状正确的空清单——路由测试要覆盖的是「读到
 * 什么、提交了什么」，不是这些 JSON 的业务内容。
 *
 * 同样是工厂不是常量：`files` 会被 commitFiles 就地改写、`commits` 会被
 * push，共享一个模块级对象会让一个测试的提交污染下一个测试读到的内容。
 */
function createDefaultContentSeed(): ContentSeed {
  return {
    files: {
      "apps/web/content/community.json": '{\n  "contactChannels": [],\n  "communityChannels": []\n}\n',
      "apps/web/content/donate.json": '{\n  "methods": []\n}\n',
      "apps/web/content/friend-links.json": '{\n  "links": []\n}\n',
    },
    commitError: null,
    commits: [],
  };
}

function createDefaultSeed(): FakeSeed {
  return {
    ...createDefaultRepoSeed(),
    ...createDefaultActionsSeed(),
    ...createDefaultContentSeed(),
  };
}

/** 建一份闭包 `state` 的 RepoClient 方法集合——不带 `seed`，给下面几个 create* 复用。 */
function repoMethods(state: RepoSeed): RepoClient {
  return {
    async getRepoInfo() {
      if (state.repoError) throw state.repoError;
      return state.repo;
    },

    async listBranches() {
      return state.branches;
    },
  };
}

/** 建一份闭包 `state` 的 ActionsClient 方法集合——不带 `seed`，给下面几个 create* 复用。 */
function actionsMethods(state: ActionsSeed): ActionsClient {
  return {
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
}

/**
 * 内存假实现里的 sha：正文的一个确定性摘要（FNV-1a）。真假不重要，稳定才
 * 重要——「读到的 sha」和「提交时带回来的 baseSha」必须能对上，才测得了
 * 第一层锁。
 *
 * 手写而不是用 `Bun.hash`：这个 app 刻意不装 `@types/bun`（见
 * bun-test.d.ts 顶部的说明——它的全局声明会跟客户端要的 DOM lib 打架），
 * 所以 `Bun` 这个全局在 `tsc --noEmit` 眼里根本不存在。
 */
function shaOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `sha-${hash.toString(16)}`;
}

/**
 * 建一份闭包 `state` 的 ContentClient 方法集合。
 *
 * 假实现**也实现了第一层锁**（逐文件比对 blob sha）——路由测试里「冲突 →
 * 409」那条路径必须能在不打网络的前提下走通，所以这里抛的也是真的
 * `GitDataStepError`，带着同样的 step/status/conflictPaths。
 */
function contentMethods(state: ContentSeed): ContentClient {
  return {
    async getContentFile(path) {
      const text = state.files[path];
      if (text === undefined) throw new GitHubRequestError(`${path} 不存在`, 404);
      return { path, text, sha: shaOf(text) };
    },

    async commitFiles(input) {
      if (state.commitError) throw state.commitError;
      const conflicts = input.files
        .filter((file) => shaOf(state.files[file.path] ?? "") !== file.baseSha)
        .map((file) => file.path);
      if (conflicts.length > 0) {
        throw new GitDataStepError(
          "verify-blob",
          `仓库里这些文件已被改过：${conflicts.join("、")}`,
          409,
          conflicts
        );
      }
      state.commits.push(input);
      for (const file of input.files) state.files[file.path] = file.content;
      const commitSha = `commit-${state.commits.length}`;
      return { commitSha, commitUrl: `https://github.com/fake/fake/commit/${commitSha}` };
    },
  };
}

/**
 * 只覆盖仓库元数据领域的假实现——给只依赖 `RepoClient` 的消费方（目前是
 * `routes/me.ts`）用，不用连带种 Actions 那一堆 workflow/run/job 数据。
 */
export function createFakeRepoClient(seed: Partial<RepoSeed> = {}): RepoClient & { seed: RepoSeed } {
  const state: RepoSeed = { ...createDefaultRepoSeed(), ...seed };
  const client: RepoClient & { seed: RepoSeed } = {
    seed: state,
    ...repoMethods(state),
  };
  return client;
}

/**
 * 只覆盖 GitHub Actions 领域的假实现——给只依赖 `ActionsClient`（或它的
 * 子集，比如 run-poller.ts 的 `Pick<ActionsClient, "listRuns">`）的消费方
 * 用。内容编辑领域按同样的样子加在下面（`createFakeContentClient`）。
 */
export function createFakeActionsClient(
  seed: Partial<ActionsSeed> = {}
): ActionsClient & { seed: ActionsSeed } {
  const state: ActionsSeed = { ...createDefaultActionsSeed(), ...seed };
  const client: ActionsClient & { seed: ActionsSeed } = {
    seed: state,
    ...actionsMethods(state),
  };
  return client;
}

/**
 * 只覆盖内容编辑领域的假实现——给只依赖 `ContentClient` 的消费方（内容路由）
 * 用，不用连带种 Repo/Actions 的数据。
 */
export function createFakeContentClient(
  seed: Partial<ContentSeed> = {}
): ContentClient & { seed: ContentSeed } {
  const state: ContentSeed = { ...createDefaultContentSeed(), ...seed };
  const client: ContentClient & { seed: ContentSeed } = {
    seed: state,
    ...contentMethods(state),
  };
  return client;
}

/**
 * 全部能力的假实现——组合上面几个领域的方法集合，共用同一份 `state`
 * （不是分别建两份再合并：`repoMethods`/`actionsMethods` 闭包的必须是
 * 同一个对象引用，否则测试改 `client.seed.runs` 之后，`listRuns` 读到的
 * 还是另一份没被改过的状态）。给需要横跨两个领域的消费方用——目前是
 * `routes/actions.ts`（dispatch 端点在没传 ref 时要读 getRepoInfo）和
 * 各条集成测试（app.test.ts、routes/actions.test.ts、run-poller.test.ts）。
 */
export function createFakeGitHubClient(seed: Partial<FakeSeed> = {}) {
  const state: FakeSeed = { ...createDefaultSeed(), ...seed };

  const client: GitHubClient & { seed: FakeSeed } = {
    seed: state,
    ...repoMethods(state),
    ...actionsMethods(state),
    ...contentMethods(state),
  };

  return client;
}
