// 前后端共用的数据形状。客户端 import 这里的类型，服务端返回这里的类型，
// 改一处两边一起红。不要在这里放任何运行时逻辑——它会被打进浏览器包。

export type RepoInfo = {
  owner: string;
  repo: string;
  defaultBranch: string;
};

export type MeResponse = {
  email: string;
  /** GitHub App 连得通时是仓库信息，连不通是 null。 */
  repo: RepoInfo | null;
  /** 连不通时的原因，供界面直接显示。连得通是 null。 */
  repoError: string | null;
};

export type RunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "waiting"
  | "requested"
  | "pending";

export type RunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale"
  | null;

export type WorkflowSummary = {
  id: number;
  name: string;
  path: string;
  state: string;
};

export type BranchSummary = {
  name: string;
  protected: boolean;
};

export type RunSummary = {
  id: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  /** 触发源：push / workflow_dispatch / schedule / pull_request … */
  event: string;
  branch: string;
  sha: string;
  createdAt: string;
  updatedAt: string;
  runNumber: number;
  htmlUrl: string;
};

export type JobStep = {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type RunJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: JobStep[];
};

export type RunDetail = {
  run: RunSummary;
  jobs: RunJob[];
};

export type FailedStepLog = {
  jobName: string;
  stepName: string;
  /** 日志尾部，最多 200 行。 */
  lines: string[];
};

/** 一次读取到的内容文件：正文加它当前的 blob sha（乐观锁的第一层用它）。 */
export type ContentFileBlob = {
  path: string;
  text: string;
  sha: string;
};

/** GET /api/content 返回的清单条目。 */
export type ContentFileMeta = {
  key: string;
  path: string;
  title: string;
  module: string;
};

/** GET /api/content/:key 的响应。 */
export type ContentFileResponse = {
  key: string;
  path: string;
  title: string;
  /** 解析好的 JSON。形状由 content-schema 的注册表决定。 */
  data: unknown;
  /** 客户端原样带回 POST /api/content/commit。 */
  sha: string;
};

/** POST /api/content/commit 的请求体。 */
export type ContentCommitRequest = {
  message: string;
  files: { key: string; data: unknown; baseSha: string }[];
};

/** POST /api/content/commit 成功时的响应（外面还包一层 accepted: true）。 */
export type ContentCommitResult = {
  commitSha: string;
  commitUrl: string;
};
