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
};

type Subscriber = (changes: RunChange[]) => void;

export function createRunPoller(deps: RunPollerDeps) {
  const activeIntervalMs = deps.activeIntervalMs ?? 5_000;
  const idleIntervalMs = deps.idleIntervalMs ?? 60_000;
  const perPage = deps.perPage ?? 30;

  let snapshot: RunSummary[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const subscribers = new Set<Subscriber>();

  const tick = async () => {
    try {
      const next = await deps.github.listRuns({ perPage });
      const changes = diffRuns(snapshot, next);
      snapshot = next;
      if (changes.length > 0) {
        for (const subscriber of subscribers) subscriber(changes);
      }
    } catch (error) {
      // 轮询失败不该让循环停掉：GitHub 偶发 5xx、网络抖动都会走到这里，
      // 下一轮大概率就好了。停掉的话界面会永远停在旧状态且毫无提示。
      console.error("[run-poller] 轮询失败：", error);
    }

    if (!running) return;
    timer = setTimeout(tick, hasActiveRun(snapshot) ? activeIntervalMs : idleIntervalMs);
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
