import type { RunSummary } from "@/shared/dto";

import type { GitHubClient } from "../github/client";
import { diffRuns, hasActiveRun, type RunChange } from "./run-diff";

export type RunPollerDeps = {
  github: GitHubClient;
  /** 有 run 在跑时的间隔，默认 5 秒。 */
  activeIntervalMs?: number;
  /** 全部空闲时的间隔，默认 60 秒。 */
  idleIntervalMs?: number;
  perPage?: number;
  /**
   * 一轮轮询（`github.listRuns` 那一次调用）最多等多久，默认 25 秒。
   *
   * 这是独立于 `github` 具体实现的最后一道保险：`octokit-client.ts` 已经给
   * 每个真实请求挂了 20 秒的 `AbortSignal.timeout`，但 poller 不应该依赖
   * 「注入进来的 `github` 恰好实现了超时」这件事——测试注入的假实现、以后
   * 可能出现的别的 `GitHubClient` 实现，都不保证会自己 settle。这里的超时
   * 比 octokit-client 的请求超时略长，正常情况下应该是 octokit-client 自己
   * 先超时、给出一个带状态码的 GitHubRequestError；这一层只在那道防线也
   * 失效时兜底，保证 `tick()` 无论如何都会走到下面重新调度那一步。
   */
  pollTimeoutMs?: number;
};

type Subscriber = (changes: RunChange[]) => void;

/**
 * 把 `promise` 跟一个超时赛跑：谁先 settle 用谁的结果。
 *
 * 超时赢了之后，原始 `promise` 不会被取消（`GitHubClient` 接口没给取消的
 * 缝隙）——它会在后台继续跑，最终的结果被下面这个 `.then` 接住之后直接
 * 丢弃（`resolve`/`reject` 在一个已经 settle 的 promise 上调用是没有效果
 * 的空操作）。已经挂了 `.then(onFulfilled, onRejected)`，所以就算它最终
 * reject，也不会变成 unhandled rejection。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createRunPoller(deps: RunPollerDeps) {
  const activeIntervalMs = deps.activeIntervalMs ?? 5_000;
  const idleIntervalMs = deps.idleIntervalMs ?? 60_000;
  const perPage = deps.perPage ?? 30;
  const pollTimeoutMs = deps.pollTimeoutMs ?? 25_000;

  let snapshot: RunSummary[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const subscribers = new Set<Subscriber>();

  const tick = async () => {
    // 预先定好兜底的下一轮间隔，并且——这一点必须留在这里，不要挪走——
    // 定成 idleIntervalMs，不是「按 snapshot 现在的状态算一个」：
    //
    //   1. 不管 try 里发生什么，`finally` 里都有一个可用的值可以重新
    //      调度，不会因为算「下一轮该等多久」本身出错就连累重新调度
    //      也不执行。
    //   2. 这同时是现在唯一挡住「限流时被打爆」的机制。下面 try 块里，
    //      只有 *成功* 轮询的最后一步才会把它改成 activeIntervalMs；
    //      任何异常——包括 octokit-client.ts 里 noRetryOnRateLimit 让
    //      限流立刻失败产生的那种异常——都不会走到那一步，
    //      `nextIntervalMs` 就停在这里预设的 idleIntervalMs。换句话说：
    //      一次成功、后面全是失败，退避会自动生效，不需要额外的状态机。
    //      octokit 自己「等满 retryAfter 再重试」的行为已经被关掉（换
    //      来的是立刻失败、界面能看到），如果这里“简化”成无条件
    //      `hasActiveRun(snapshot) ? activeIntervalMs : idleIntervalMs`，
    //      一次持续限流会变成每个 activeIntervalMs（生产环境 5 秒）打
    //      一次 GitHub，而不是退避到 idleIntervalMs（60 秒）——这个回归
    //      不会让任何类型检查或明显的测试失败，只会在真的撞上限流那天
    //      才现形，所以务必保留这个「只在成功路径上前进、失败一律回落
    //      到 idle」的结构，并且有 run-poller.test.ts 里「轮询失败后
    //      退回空闲间隔」那条测试钉住它。
    //
    // 这里还刻意把 `hasActiveRun(snapshot)` 挪到了 try 内部——修复前它在
    // try/catch 外面（紧跟着 `setTimeout` 调用那一行），如果它本身抛错
    // （比如 snapshot 里混进了形状不对的数据），会让整个 tick() 抛出未
    // 处理的异常，重新调度那行代码根本不会执行到。挪进 try 之后，这类
    // 错误跟其它处理阶段的错误一样，被下面的 catch 统一接住——同样落到
    // 上面第 2 点说的「失败就回落到 idle」这条规则里。
    let nextIntervalMs = idleIntervalMs;
    try {
      const next = await withTimeout(
        deps.github.listRuns({ perPage }),
        pollTimeoutMs,
        `[run-poller] listRuns 超过 ${pollTimeoutMs}ms 未返回，本轮按超时处理`
      );
      const changes = diffRuns(snapshot, next);
      snapshot = next;
      if (changes.length > 0) {
        for (const subscriber of subscribers) subscriber(changes);
      }
      nextIntervalMs = hasActiveRun(snapshot) ? activeIntervalMs : idleIntervalMs;
    } catch (error) {
      // 轮询失败不该让循环停掉：GitHub 偶发 5xx、网络抖动、请求超时都会走
      // 到这里，下一轮大概率就好了。停掉的话界面会永远停在旧状态且毫无
      // 提示。`nextIntervalMs` 保持上面预设的 idleIntervalMs 兜底值——
      // 失败了就不用 snapshot 判断是否有活跃 run，避免用一份可能过期的
      // 快照做决定。
      console.error("[run-poller] 轮询失败：", error);
    } finally {
      // 重新调度放在 finally 里，而不是紧跟在 try/catch 后面：这是刻意的
      // ——不管 try 块里跑出什么意外（哪怕是这份代码目前没预见到的，或者
      // 以后有人在 catch 块里加了一行会抛错的代码），finally 都保证会
      // 执行到，「下一轮还会不会发生」不应该依赖 try/catch 里每一行都
      // 不出错。这正是 poller 能不能在几周的无人值守运行里挺过各种意外
      // 的分界线。
      if (running) {
        timer = setTimeout(tick, nextIntervalMs);
      }
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      void tick();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    snapshot: () => snapshot,
    subscribe(fn: Subscriber) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}

export type RunPoller = ReturnType<typeof createRunPoller>;
