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
});
