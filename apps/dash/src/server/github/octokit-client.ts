import { App, Octokit as OctokitCtor } from "octokit";

import type {
  BranchSummary,
  FailedStepLog,
  RepoInfo,
  RunDetail,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

import {
  GitHubRequestError,
  type ActionsClient,
  type GitHubClient,
  type RepoClient,
} from "./client";

export type OctokitClientConfig = {
  appId: string;
  privateKey: string;
  installationId: number;
  owner: string;
  repo: string;
};

/**
 * 读操作（GET，幂等）单次请求的超时。GitHub 正常响应通常一两秒以内，
 * 20 秒已经非常宽松——这道超时防的不是「慢」，是「根本不会有响应」：
 * 隧道/NAT 抖动之后留下的半开 TCP 连接、Bun 的 `fetch` 本身没有默认超时。
 * 不加超时的话 `withOctokit` 里那个 `await` 就永远不会 settle：poller 的
 * `tick()` 卡死、共用同一个 octokit 实例的路由 handler（比如 `/api/runs`）
 * 也跟着卡死，且没有任何日志或界面提示——这正是「healthcheck 看着健康，
 * 界面再也不更新」这个故障模式的根因之一。
 */
const READ_TIMEOUT_MS = 20_000;

/**
 * 写操作（dispatch/rerun/cancel）单次请求的超时，比读操作更长。
 *
 * 这三个操作不是幂等的：`AbortSignal` 只能让*我们*停止等待，不能撤回已经
 * 发到 GitHub 那边、可能已经被接受并开始执行的请求。如果超时定得跟读操作
 * 一样短，一次单纯「GitHub 这次响应比较慢」（不是真的连不上）就可能被误判
 * 成失败——用户看到报错，若因此又点一次 dispatch，就可能真的触发两次构建
 * （仓库描述里特别强调过这后果有多真实）。拉长写操作的超时窗口，把「响应
 * 只是慢」被误判成「必须放弃」的概率降到更低；不可能降到零——彻底避免这个
 * 问题需要 GitHub 支持幂等键，Actions 的 dispatch/rerun/cancel API 不提供
 * 这个能力，客户端超时天然做不到「保证不会在服务端已经生效之后才报错」。
 * 我们接受这个残余风险：不加超时的话，写操作会重新掉回 I-1 想解决的那个
 * 「永远卡住」的坑，只是症状从「静默」换成「界面转圈转到天荒地老」，并不
 * 更好。
 */
const WRITE_TIMEOUT_MS = 45_000;

/**
 * 现铸一个超时 signal。`AbortSignal.timeout()` 是一次性的——fire 过一次
 * 之后就永远是 aborted 状态，缓存/复用会导致下一次调用还没真的发出请求
 * 就直接判超时，所以每次调用都要在这里现建一个，不能提到函数外面存成
 * 一个共享变量。
 */
function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/**
 * 限流（403/429）时的策略：不等、不重试，让错误立刻抛出去。
 *
 * octokit 包（`octokit@5.0.5`，见 `node_modules/.../octokit/dist-src/
 * octokit.js`）默认给 `throttle.onRateLimit`/`onSecondaryRateLimit` 接的
 * 处理函数，在 `retryCount === 0` 时返回 `true`——也就是「等满 retryAfter
 * 再重试一次」。primary 限流的 retryAfter 由响应里的 `x-ratelimit-reset`
 * 算出来，最长可以是快一小时之后；这段等待期间 `withOctokit` 里的 await
 * 根本不会 settle，调用方（poller 的 `tick()`、或者用户点一下 dispatch 之后
 * 挂起的路由 handler）跟着一起卡住——且没有任何日志、没有界面提示，跟真正
 * 死锁长得一模一样。这条等待路径本身不打任何新的网络请求（是 Bottleneck
 * 内部的 `setTimeout`），`READ_TIMEOUT_MS`/`WRITE_TIMEOUT_MS` 那个挂在单次
 * 请求上的 `AbortSignal` 对它完全不起作用——限流必须单独处理，不能指望
 * 超时顺带把它也解决了。
 *
 * 我们选择立刻失败，不重试：错误经 `toRequestError` 变成 `GitHubRequestError`
 * （status 403 或 429），被 `status.ts` 的 `statusFor` 映射成 502——界面上
 * 看得到「失败」，而不是转圈转到天荒地老。poller 本来就会在 5s/60s 之后
 * 自己再戳一次 GitHub，用户手动触发的操作失败了也能自己决定要不要重试，
 * 都好过程序替他们背着静默等一个小时。
 */
// 导出给测试用：octokit-client.test.ts 拿它拼一个装了同一份限流策略的
// Octokit 实例，直接验证「真的不会等、不会重试」——而不是只孤零零地断言
// 这个函数自己的返回值（那种测试改不动任何有意义的东西：把这个函数删了
// 换成别的名字，测试一样绿）。
export function noRetryOnRateLimit(): false {
  return false;
}

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

/** 铸出一枚新的、已完成安装态鉴权的 octokit 实例。 */
export type MintOctokit = () => Promise<Octokit>;

/**
 * 装好限流策略（见上面 `noRetryOnRateLimit` 的大段注释）的 Octokit 类。
 *
 * `App` 内部铸 app-level 实例时（`this.octokit = new Octokit(octokitOptions)`）
 * 和铸 installation-scoped 实例时（`getInstallationOctokit` 里的
 * `new auth.octokit.constructor(options)`，`auth.octokit` 就是上面那个
 * app-level 实例）用的是同一个类，所以只要把这个类传给 `new App({ Octokit })`
 * 一次，两处实例都会带上这份限流策略——不需要在 `App` 构造之外另外找地方
 * 挂 `onRateLimit`。
 */
const ThrottledOctokit = OctokitCtor.defaults({
  throttle: {
    onRateLimit: noRetryOnRateLimit,
    onSecondaryRateLimit: noRetryOnRateLimit,
  },
});

/** 生产环境用的默认铸造函数：真的构造一个 App 并向 GitHub 换安装态 token。 */
function defaultMintOctokit(config: OctokitClientConfig): MintOctokit {
  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    Octokit: ThrottledOctokit,
  });
  return () => app.getInstallationOctokit(config.installationId);
}

/**
 * @param mintOctokit 铸造函数，缺省时用真的 GitHub App 换 token。测试注入一个
 *   不打网络的假实现，用来验证 `withOctokit` 的「失败后清缓存、下次真的换新
 *   实例」这条契约——这是 `createOctokitGitHubClient` 唯一的可测试缝隙，
 *   因为它内部原本直接 `new App(...)`，没有缝隙就只能连真 GitHub 才能测。
 */
export function createOctokitGitHubClient(
  config: OctokitClientConfig,
  mintOctokit: MintOctokit = defaultMintOctokit(config)
): GitHubClient {
  // 缓存的是 octokit 实例，不是 token —— token 的换取、缓存与到期刷新
  // 由 @octokit/auth-app 在实例内部处理，我们不重复造一份会过期的状态。
  let cached: Promise<Octokit> | null = null;
  const octokit = () => {
    cached ??= mintOctokit();
    return cached;
  };

  // 每个方法都要「拿实例 → 调用 → 失败时按需清缓存并抛出统一错误」，七个
  // 方法手抄七遍这段样板迟早漏掉一次该清的 `cached = null`，那个方法就
  // 悄悄退出了缓存恢复机制——认证失败一次，就把进程钉在坏实例上直到重启。
  // 这里收成一个包装：调用方只管拿到 kit 之后要做什么。
  //
  // `octokit()`（铸造）和 `fn(kit)`（用铸好的实例真的打一个 GitHub 请求）
  // 故意分成两个 try：铸造失败——不管什么原因——缓存的就是这个已经失败的
  // promise，必须清掉，否则下一次调用会一直拿到同一个坏 promise、
  // `mintOctokit` 再也不会被真的调用第二次（这条分支的契约由
  // `octokit-client.test.ts` 的「铸造失败清缓存」那条测试钉住）。
  //
  // `fn(kit)` 失败是另一回事：kit 本身是铸造成功的、没过期的实例，这次
  // 调用失败可能只是这一个请求的事——404（run/workflow 不存在）、429
  // （限流）、5xx（GitHub 那头抽风）都不代表这个 octokit 实例本身坏了，
  // 清掉缓存除了让下一次调用多花一轮网络请求重新换 installation token
  // 之外没有任何好处。Task 8/9 把轮询间隔收到 5 秒之后，这个区别不再是
  // 「理论上更干净」：`main.ts` 从进程启动就无条件跑着 poller，一次
  // GitHub 侧的持续故障期间，「每次失败都清缓存」会让进程每 5 秒换一次
  // installation token——换 token 本身也是一次请求，在真正的故障期间
  // 只会让本来就在挣扎的 GitHub App 认证端点雪上加霜，而且丢掉的是一个
  // 完全没过期、本来还能用的 token。
  //
  // 只在「凭证类失败」（401/403：token 过期、权限被收回、安装被卸载……）
  // 时才清缓存——这正是当初这条缓存清除逻辑要防的场景：实例本身已经不
  // 值得信任了，继续用只会一直失败下去，必须换一个新的。
  async function withOctokit<T>(fn: (kit: Octokit) => Promise<T>): Promise<T> {
    let kit: Octokit;
    try {
      kit = await octokit();
    } catch (error) {
      cached = null;
      throw toRequestError(error);
    }

    try {
      return await fn(kit);
    } catch (error) {
      const requestError = toRequestError(error);
      if (requestError.status === 401 || requestError.status === 403) {
        cached = null;
      }
      throw requestError;
    }
  }

  // 两个领域方法组都闭包同一个 `withOctokit`（进而闭包同一个 `cached`）——
  // 这不是两份各自独立的实现凑巧长得像，是故意只留一处铸造/缓存逻辑，两个
  // 领域共用。以后新增领域（比如 Git Data API）时照这个样子加一个
  // `createXxxMethods()`，一样传不了别的 `withOctokit` 进来，因为它压根
  // 不是参数，是闭包——这正是「一个 octokit 实例、一份缓存」在类型层面之外
  // 的结构性保证：想给某个领域另开一个实例，得先把 withOctokit 从闭包改成
  // 参数，这个改动本身足够显眼，不会在重构中被不小心带过去。

  function createRepoMethods(): RepoClient {
    return {
      async getRepoInfo(): Promise<RepoInfo> {
        return withOctokit(async (kit) => {
          const { data } = await kit.rest.repos.get({
            owner: config.owner,
            repo: config.repo,
            request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
          });
          return {
            owner: data.owner.login,
            repo: data.name,
            defaultBranch: data.default_branch,
          };
        });
      },

      /**
       * 喂分支选择器（见 routes/actions.ts 的 /api/branches）。跟
       * listWorkflows 一样只取一页——`kit.rest.repos.listBranches` 的签名与
       * 返回形状是对着安装的 `@octokit/plugin-rest-endpoint-methods@17.0.0`
       * 类型定义（`dist-types/generated/parameters-and-response-types.d.ts`）
       * 核实过的，不是凭记忆写的：`data` 是 `short-branch[]`，每项形状是
       * `{ name, commit: { sha, url }, protected, protection?, protection_url? }`。
       * adx-dl 目前只有个位数的分支（dev/pre/main 加几个短命的临时分支），
       * 100 条页大小不会漏；真长到要分页时再加。
       */
      async listBranches(): Promise<BranchSummary[]> {
        return withOctokit(async (kit) => {
          const { data } = await kit.rest.repos.listBranches({
            owner: config.owner,
            repo: config.repo,
            per_page: 100,
            request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
          });
          return data.map((branch) => ({
            name: branch.name,
            protected: branch.protected,
          }));
        });
      },
    };
  }

  function createActionsMethods(): ActionsClient {
    return {
      async listWorkflows(): Promise<WorkflowSummary[]> {
        return withOctokit(async (kit) => {
          const { data } = await kit.rest.actions.listRepoWorkflows({
            owner: config.owner,
            repo: config.repo,
            per_page: 100,
            request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
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
            request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
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
              request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
            }),
            kit.rest.actions.listJobsForWorkflowRun({
              owner: config.owner,
              repo: config.repo,
              run_id: runId,
              per_page: 100,
              request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
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

      async dispatchWorkflow(workflowId: number, ref: string): Promise<void> {
        return withOctokit(async (kit) => {
          await kit.rest.actions.createWorkflowDispatch({
            owner: config.owner,
            repo: config.repo,
            workflow_id: workflowId,
            ref,
            request: { signal: timeoutSignal(WRITE_TIMEOUT_MS) },
          });
        });
      },

      async rerunRun(runId: number): Promise<void> {
        return withOctokit(async (kit) => {
          await kit.rest.actions.reRunWorkflow({
            owner: config.owner,
            repo: config.repo,
            run_id: runId,
            request: { signal: timeoutSignal(WRITE_TIMEOUT_MS) },
          });
        });
      },

      async cancelRun(runId: number): Promise<void> {
        return withOctokit(async (kit) => {
          await kit.rest.actions.cancelWorkflowRun({
            owner: config.owner,
            repo: config.repo,
            run_id: runId,
            request: { signal: timeoutSignal(WRITE_TIMEOUT_MS) },
          });
        });
      },

      async getFailedStepLog(runId: number): Promise<FailedStepLog | null> {
        return withOctokit(async (kit) => {
          const { data } = await kit.rest.actions.listJobsForWorkflowRun({
            owner: config.owner,
            repo: config.repo,
            run_id: runId,
            per_page: 100,
            request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
          });

          const failedJob = data.jobs.find((job) => job.conclusion === "failure");
          if (!failedJob) return null;
          const failedStep = (failedJob.steps ?? []).find((step) => step.conclusion === "failure");

          // 单个 job 的日志是纯文本（整个 run 的日志是 zip，不要用那个）。
          const log = await kit.rest.actions.downloadJobLogsForWorkflowRun({
            owner: config.owner,
            repo: config.repo,
            job_id: failedJob.id,
            request: { signal: timeoutSignal(READ_TIMEOUT_MS) },
          });

          const text = typeof log.data === "string" ? log.data : String(log.data ?? "");
          // 先按空行过滤，再取尾部：过滤要在切片之前做，否则最后 200 行里可能
          // 混进一堆空行，把真正有信息量的日志行挤出这个窗口。构建日志动辄
          // 上万行，全量传到浏览器没有意义，失败原因也几乎总在末尾。
          const lines = text
            .split("\n")
            .filter((line) => line.trim())
            .slice(-200);

          return {
            jobName: failedJob.name,
            stepName: failedStep?.name ?? "(未知步骤)",
            lines,
          };
        });
      },
    };
  }

  return {
    ...createRepoMethods(),
    ...createActionsMethods(),
  };
}
