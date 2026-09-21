import { describe, expect, test } from "bun:test";

import type { RunSummary } from "@/shared/dto";

import { createFakeGitHubClient } from "../github/fake-client";
import type { RunChange } from "./run-diff";
import { createRunPoller } from "./run-poller";

// 刻意不测「等了 5 秒还是 60 秒」——那是纯计时断言，慢机器上会抖。
// 这里只测三条与计时无关、但对生产环境的健壮性至关重要的性质：轮询失败
// 不会让循环死掉、stop() 真的能让循环停下来、没变化时不会瞎广播。用真
// 定时器 + 很短的间隔（15ms）驱动，靠等一个具体事件（广播/调用次数）
// 而不是固定 sleep 来同步，把测试时间压到几十到一百多毫秒。

function run(overrides: Partial<RunSummary> & { id: number }): RunSummary {
  return {
    name: "Build and Publish gh-pages",
    status: "completed",
    conclusion: "success",
    event: "push",
    branch: "main",
    sha: "abc1234",
    createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:05:00Z",
    runNumber: 1,
    htmlUrl: "https://example.test/run",
    ...overrides,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 在 fake client 之上包一层，让 listRuns 的行为在测试里可控：
 * 数调用次数、按需让某一次调用抛错、随时替换下一次返回的数据。
 */
function createControllableGitHubClient(initialRuns: RunSummary[] = []) {
  const base = createFakeGitHubClient({ runs: initialRuns });
  let calls = 0;
  let pendingError: Error | null = null;

  return {
    ...base,
    async listRuns(opts?: { perPage?: number }) {
      calls++;
      if (pendingError) {
        const error = pendingError;
        pendingError = null;
        throw error;
      }
      return base.seed.runs.slice(0, opts?.perPage ?? 30);
    },
    callCount: () => calls,
    queueError(error: Error) {
      pendingError = error;
    },
    setRuns(next: RunSummary[]) {
      base.seed.runs = next;
    },
  };
}

/** 等第一次广播，返回广播内容；不猜时间，靠 subscribe 的回调同步。 */
function nextBroadcast(poller: ReturnType<typeof createRunPoller>): Promise<RunChange[]> {
  return new Promise((resolve) => {
    const unsubscribe = poller.subscribe((changes) => {
      unsubscribe();
      resolve(changes);
    });
  });
}

describe("createRunPoller resilience", () => {
  test("轮询失败不会让循环停掉——下一次成功后仍会广播并更新 snapshot", async () => {
    const github = createControllableGitHubClient([]);
    const poller = createRunPoller({ github, activeIntervalMs: 15, idleIntervalMs: 15 });

    // 第一次轮询失败；第二次成功返回一个新 run。
    github.queueError(new Error("network blip"));
    const nextRuns = [run({ id: 1, status: "in_progress", conclusion: null })];
    github.setRuns(nextRuns);

    const broadcast = nextBroadcast(poller);
    poller.start();
    const changes = await broadcast;
    poller.stop();

    // 失败的那一轮完全不产出变化（diffRuns 根本没机会跑），
    // 所以等到的这条广播必然来自失败之后的下一轮成功轮询。
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    expect(poller.snapshot()).toEqual(nextRuns);
    // 至少两次调用：失败的那次 + 成功的那次。
    expect(github.callCount()).toBeGreaterThanOrEqual(2);
  });

  test("stop() 真的会停掉轮询——之后调用次数不再增长", async () => {
    const github = createControllableGitHubClient([run({ id: 1 })]);
    const poller = createRunPoller({ github, activeIntervalMs: 15, idleIntervalMs: 15 });

    poller.start();
    // 等它先真的跑起来——覆盖好几个 15ms 的间隔，确认调用次数在涨。
    await sleep(60);
    const callsWhileRunning = github.callCount();
    expect(callsWhileRunning).toBeGreaterThan(0);

    poller.stop();
    const callsAtStop = github.callCount();

    // stop() 之后再等远超一个间隔的时间：调用次数不该再往上涨。
    // 这条断言测的是「循环没有继续」这个确定性事实，不是某次间隔的
    // 精确时长，所以不算计时断言。
    await sleep(120);

    expect(github.callCount()).toBe(callsAtStop);
  });

  test("快照没变化时不会广播", async () => {
    const runs = [run({ id: 1 })];
    const github = createControllableGitHubClient(runs);
    const poller = createRunPoller({ github, activeIntervalMs: 15, idleIntervalMs: 15 });

    // 第一轮必然从空快照变成有一个 run，这条广播是预期内的，先等它过去。
    const first = nextBroadcast(poller);
    poller.start();
    await first;

    let notifications = 0;
    poller.subscribe(() => {
      notifications++;
    });
    const callsAfterFirst = github.callCount();

    // 之后 listRuns 每次都返回同样内容的数据（不需要同一个数组引用，
    // diffRuns 按字段比较）；确认接下来好几个轮询周期都没有广播。
    await sleep(80);
    poller.stop();

    // 确认循环在这段时间里确实还在跑，不是因为压根没轮询才没广播。
    expect(github.callCount()).toBeGreaterThan(callsAfterFirst);
    expect(notifications).toBe(0);
  });
});
