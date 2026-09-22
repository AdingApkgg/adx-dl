import type {
  BranchSummary,
  ContentFileBlob,
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
 * 内容文件的读写。写走 Git Data API（blob → tree → commit → update ref），
 * 因为 `contents` API 一次只能写一个文件，而这里的需求是「多文件一个 commit」
 * （见 spec §10.3：main 上每个 commit 触发一次数分钟的完整部署）。
 *
 * 整套六步被关在 commitFiles 里面，不拆成六个接口方法：拆开的话每个调用方都得
 * 自己按正确顺序编排，并发保护也会散在各处；而内存假实现要模拟的是「提交这批
 * 文件」这件事，不是六次 API 调用。
 */
export interface ContentClient {
  /** 读一个文件的正文与当前 blob sha。文件不存在时抛 status 404 的错误。 */
  getContentFile(path: string): Promise<ContentFileBlob>;
  /** 把多个文件合成一个 commit 推上去。并发保护见实现里的两层锁注释。 */
  commitFiles(input: CommitFilesInput): Promise<CommitFilesResult>;
}

export type CommitFilesInput = {
  branch: string;
  message: string;
  files: {
    path: string;
    /** 完整的新文件正文，含末尾换行。 */
    content: string;
    /** 客户端读到这个文件时的 blob sha，用来做第一层锁。 */
    baseSha: string;
  }[];
};

export type CommitFilesResult = {
  commitSha: string;
  commitUrl: string;
};

/** commitFiles 的六步里，是哪一步失败的。 */
export type GitDataStep =
  | "read-head"
  | "read-base-commit"
  | "verify-blob"
  | "create-blob"
  | "create-tree"
  | "create-commit"
  | "update-ref";

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
export interface GitHubClient extends RepoClient, ActionsClient, ContentClient {}

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

/**
 * 带步骤标识的 GitHub 错误。
 *
 * 为什么需要它：多步提交里「创建 blob 失败」和「更新 ref 失败」是**处境完全不同**
 * 的两件事——前者什么都没发生，重试即可；后者说明仓库在这几百毫秒里被人动过，
 * 重试之前必须重新加载。而 GitHubRequestError 只带 message 和 status，这两种情况
 * 在界面上会长得一模一样。
 *
 * 它继承 GitHubRequestError，所以 withGitHubErrors / statusFor 那条既有路径照常
 * 工作，路由只是多了一个 instanceof 可以用来拼更准的话。
 *
 * 位置必须在 GitHubRequestError **之后**：`extends` 子句在类定义语句执行时求值，
 * 放到父类声明之前会在模块加载时就炸 TDZ（ReferenceError: Cannot access
 * 'GitHubRequestError' before initialization）——跟上面那些纯类型的接口不一样，
 * 这一个有运行时语义，不能跟着 ContentClient 放到文件中段。
 */
export class GitDataStepError extends GitHubRequestError {
  constructor(
    readonly step: GitDataStep,
    message: string,
    status: number | null,
    /** 仅 step === "verify-blob" 时有值：被别人改过的那些文件路径。 */
    readonly conflictPaths: readonly string[] = []
  ) {
    super(message, status);
    this.name = "GitDataStepError";
  }
}
