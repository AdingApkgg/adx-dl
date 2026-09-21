import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { RunSummary } from "@/shared/dto";

import type { RunChange } from "../actions/run-diff";
import type { AccessVariables } from "../middleware/access-jwt";

/** 只要求 poller 的这部分能力，方便测试注入一个不带定时器的假货。 */
export type EventsPoller = {
  subscribe(fn: (changes: RunChange[]) => void): () => void;
  snapshot(): RunSummary[];
};

export type EventsDeps = {
  poller: EventsPoller;
};

export function registerEventsRoute(
  app: Hono<{ Variables: AccessVariables }>,
  deps: EventsDeps
) {
  app.get("/api/events", (c) => {
    // 中间有任何反代时，缓冲会把 SSE 退化成「长时间无事发生，然后一次性全到」。
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      let unsubscribe = () => {};

      // `stream.closed` is only set by `.close()` (a normal end-of-callback
      // exit); a client disconnect goes through `.abort()` instead, which
      // only flips `stream.aborted`. Racing on a promise that resolves from
      // `onAbort` but then re-checking `stream.closed` never breaks the loop:
      // the already-settled promise makes `Promise.race` resolve instantly
      // on every subsequent turn, spinning a tight, CPU-pinning loop forever.
      // `isDone()` has to check both flags.
      const aborted = new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
      const isDone = () => stream.closed || stream.aborted;

      const pending: RunChange[][] = [];
      let notify: (() => void) | null = null;

      unsubscribe = deps.poller.subscribe((changes) => {
        pending.push(changes);
        notify?.();
      });

      while (!isDone()) {
        while (pending.length > 0 && !isDone()) {
          await stream.writeSSE({
            event: "runs",
            data: JSON.stringify(pending.shift()),
          });
        }

        if (isDone()) break;

        // 等下一批变化，或者等客户端断开；30 秒没动静就发一次心跳，
        // 免得中间的代理把这条闲置连接掐掉。
        const woken = new Promise<void>((resolve) => {
          notify = resolve;
        });
        const heartbeat = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
        await Promise.race([woken, heartbeat, aborted]);
        notify = null;

        if (isDone()) break;
        if (pending.length === 0) {
          await stream.writeSSE({ event: "ping", data: "" });
        }
      }

      unsubscribe();
    });
  });
}
