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
