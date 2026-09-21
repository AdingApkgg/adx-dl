import type { RunSummary } from "@/shared/dto";

export type RunChange = {
  kind: "added" | "updated" | "finished";
  run: RunSummary;
};

/**
 * 比对两次 run 快照。
 *
 * 刻意只看 status 与 conclusion，不看 updatedAt —— GitHub 会因为无关紧要的
 * 原因刷新 updated_at，把它当成变化会让界面每个轮询周期抖一次。
 * run 从分页窗口滑出也不产出变化：那不是发生了什么，只是看不到了。
 */
export function diffRuns(previous: RunSummary[], next: RunSummary[]): RunChange[] {
  const before = new Map(previous.map((run) => [run.id, run]));
  const changes: RunChange[] = [];

  for (const run of next) {
    const old = before.get(run.id);

    if (!old) {
      changes.push({ kind: "added", run });
      continue;
    }

    if (old.status === run.status && old.conclusion === run.conclusion) continue;

    // 「刚刚跑完」与「进度推进了」对界面是两回事：前者该提示，后者只该刷新。
    const justFinished = old.status !== "completed" && run.status === "completed";
    changes.push({ kind: justFinished ? "finished" : "updated", run });
  }

  return changes;
}

/** 是否还有没跑完的 run —— 轮询间隔据此在 5s 与 60s 之间切换。 */
export function hasActiveRun(runs: RunSummary[]): boolean {
  return runs.some((run) => run.status !== "completed");
}
