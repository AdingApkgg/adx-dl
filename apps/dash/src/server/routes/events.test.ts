import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { RunSummary } from "@/shared/dto";

import type { RunChange } from "../actions/run-diff";
import type { AccessVariables } from "../middleware/access-jwt";
import { registerEventsRoute } from "./events";

/** 一个不依赖定时器的假轮询器：测试自己决定什么时候推。 */
function createFakePoller() {
  const subscribers = new Set<(changes: RunChange[]) => void>();
  return {
    subscribe(fn: (changes: RunChange[]) => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    snapshot: (): RunSummary[] => [],
    emit(changes: RunChange[]) {
      for (const fn of subscribers) fn(changes);
    },
    subscriberCount: () => subscribers.size,
  };
}

function makeApp(poller: ReturnType<typeof createFakePoller>) {
  const app = new Hono<{ Variables: AccessVariables }>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: "someone@example.com", sub: "user-1" });
    await next();
  });
  registerEventsRoute(app, { poller });
  return app;
}

describe("GET /api/events", () => {
  test("以 SSE 的内容类型响应", async () => {
    const res = await makeApp(createFakePoller()).request("/api/events");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // 中间有代理时，缓冲会把 SSE 变成「什么都不来，然后一次全来」。
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  test("有变化时推出 runs 事件", async () => {
    const poller = createFakePoller();
    const res = await makeApp(poller).request("/api/events");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    poller.emit([
      {
        kind: "finished",
        run: {
          id: 1, name: "Build", status: "completed", conclusion: "success", event: "push",
          branch: "main", sha: "abc", createdAt: "", updatedAt: "", runNumber: 1, htmlUrl: "",
        },
      },
    ]);

    const { value } = await reader.read();
    const chunk = decoder.decode(value);

    expect(chunk).toContain("event: runs");
    expect(chunk).toContain('"kind":"finished"');

    await reader.cancel();
  });

  test("处理函数异常退出时仍会退订，不留下泄漏的订阅", async () => {
    // 构造一个会让 JSON.stringify 抛错的 run：自引用对象。这不是真实
    // GitHub 数据会出现的形状，但足以确定性地复现「处理函数异常退出」
    // 这条路径——不这样测，unsubscribe 被跳过这件事就只能靠读代码发现。
    const poller = createFakePoller();
    const res = await makeApp(poller).request("/api/events");
    const reader = res.body!.getReader();

    const circular: Record<string, unknown> = { id: 1 };
    circular.self = circular;

    poller.emit([{ kind: "added", run: circular as unknown as RunSummary }]);

    // 一直读到流关闭：streamSSE 的 run() 会在 catch 里吞掉这个异常，
    // 然后在 finally 里关闭流——这是一个确定性的同步点，不用猜时间。
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
    }

    // 处理函数已经异常退出。如果 unsubscribe() 没有在 finally 里保证
    // 执行，这个假 poller 的订阅者 Set 里会一直留着这个已经死掉的闭包，
    // 之后每次 diffRuns 广播都会继续往它的 pending 数组里塞东西，
    // 没有人再读——无界增长。
    expect(poller.subscriberCount()).toBe(0);
  });
});
