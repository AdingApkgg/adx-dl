import type {
  BranchSummary,
  FailedStepLog,
  RepoInfo,
  RunDetail,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

/**
 * 后端用到的 GitHub 能力的窄接口。
 *
 * 刻意不暴露 octokit 本身：路由只依赖这个接口，测试注入内存假实现，
 * 于是路由测试一个网络请求都不打。真实实现见 octokit-client.ts。
 */
export interface GitHubClient {
  getRepoInfo(): Promise<RepoInfo>;
  listWorkflows(): Promise<WorkflowSummary[]>;
  /** 分支选择器用（见 routes/actions.ts 的 /api/branches）；不分页——见 octokit-client.ts 的实现注释。 */
  listBranches(): Promise<BranchSummary[]>;
  listRuns(opts?: { perPage?: number }): Promise<RunSummary[]>;
  getRun(runId: number): Promise<RunDetail>;
  dispatchWorkflow(workflowId: number, ref: string): Promise<void>;
  rerunRun(runId: number): Promise<void>;
  cancelRun(runId: number): Promise<void>;
  getFailedStepLog(runId: number): Promise<FailedStepLog | null>;
}

/** 真实实现向上抛的错误，路由据此回一个能看懂的消息。 */
export class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}
