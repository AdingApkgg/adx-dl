import type {
  BranchSummary,
  FailedStepLog,
  RepoInfo,
  RunDetail,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

// 后端用到的 GitHub 能力，按领域拆成下面几个窄接口，而不是一个越长越大的
// 平铺接口。刻意不暴露 octokit 本身：路由只依赖某个具体领域的接口（或它的
// 子集），测试注入内存假实现，于是路由测试一个网络请求都不打。真实实现见
// octokit-client.ts，内存假实现见 fake-client.ts——两边都按同样的领域划分
// 组织（各自一个 `create*Methods`/`createFake*Client`）。
//
// 新增一个领域（比如内容编辑阶段要加的 Git Data API——读文件、建 blob/
// tree/commit、改 ref；再往后的 Pull Requests）时，在这里新增一个接口、
// 加进下面 GitHubClient 的 extends 列表。不要把新方法塞进 RepoClient/
// ActionsClient——那样会让「消费方只依赖自己用得到的领域」这件事失去意义，
// 也会让那个领域的假实现重新变成「实现全部方法才能用」。

/** 仓库元数据：这是哪个仓库、它有哪些分支，跟某一次具体的 CI 运行无关。 */
export interface RepoClient {
  getRepoInfo(): Promise<RepoInfo>;
  /** 分支选择器用（见 routes/actions.ts 的 /api/branches）；不分页——见 octokit-client.ts 的实现注释。 */
  listBranches(): Promise<BranchSummary[]>;
}

/** GitHub Actions：工作流、运行、job/step、失败日志，以及 dispatch/rerun/cancel。 */
export interface ActionsClient {
  listWorkflows(): Promise<WorkflowSummary[]>;
  listRuns(opts?: { perPage?: number }): Promise<RunSummary[]>;
  getRun(runId: number): Promise<RunDetail>;
  dispatchWorkflow(workflowId: number, ref: string): Promise<void>;
  rerunRun(runId: number): Promise<void>;
  cancelRun(runId: number): Promise<void>;
  getFailedStepLog(runId: number): Promise<FailedStepLog | null>;
}

/**
 * 后端用到的全部 GitHub 能力：上面两个领域接口的组合。
 *
 * 真正需要「全部能力」的消费方不多：两个实现本身（octokit-client.ts/
 * fake-client.ts 都要能同时喂给所有路由）、`app.ts` 的 `AppDeps`（它把
 * 同一个 client 转手发给好几个路由，每个路由再各自窄化）、以及
 * `routes/actions.ts`（它的 dispatch 端点在没传 ref 时会读 getRepoInfo
 * 取默认分支，所以真的横跨两个领域，不是偷懒没窄化）。除此之外的消费方
 * 应该直接依赖 RepoClient/ActionsClient（或它们的子集，比如
 * `Pick<ActionsClient, "listRuns">`），而不是这个组合类型。
 */
export interface GitHubClient extends RepoClient, ActionsClient {}

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
