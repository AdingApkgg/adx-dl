import { describe, expect, test } from "bun:test";

import type { RunSummary } from "@/shared/dto";

import { diffRuns, hasActiveRun } from "./run-diff";

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

describe("diffRuns", () => {
  test("新出现的 run 标记为 added", () => {
    const changes = diffRuns([], [run({ id: 1, status: "queued", conclusion: null })]);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    expect(changes[0].run.id).toBe(1);
  });

  test("状态变了标记为 updated", () => {
    const before = [run({ id: 1, status: "queued", conclusion: null })];
    const after = [run({ id: 1, status: "in_progress", conclusion: null })];

    const changes = diffRuns(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("updated");
  });

  test("跑完了标记为 finished，而不是 updated", () => {
    // 界面要靠这个区分「刷新一下进度条」和「弹一条完成提示」。
    const before = [run({ id: 1, status: "in_progress", conclusion: null })];
    const after = [run({ id: 1, status: "completed", conclusion: "failure" })];

    const changes = diffRuns(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("finished");
    expect(changes[0].run.conclusion).toBe("failure");
  });

  test("什么都没变时不产出任何变化", () => {
    const snapshot = [run({ id: 1 }), run({ id: 2 })];

    expect(diffRuns(snapshot, snapshot)).toEqual([]);
  });

  test("只有 updatedAt 变、状态没变，也不算变化", () => {
    // GitHub 会因为无关紧要的原因刷 updated_at。把它当成变化会让界面
    // 每 5 秒抖一次，也会让「完成」提示反复弹出。
    const before = [run({ id: 1, updatedAt: "2026-09-21T00:05:00Z" })];
    const after = [run({ id: 1, updatedAt: "2026-09-21T00:09:00Z" })];

    expect(diffRuns(before, after)).toEqual([]);
  });

  test("消失的 run 不产出变化", () => {
    // run 从分页窗口里滑出去不是事件，别让它变成一条噪音。
    expect(diffRuns([run({ id: 1 })], [])).toEqual([]);
  });
});

describe("hasActiveRun", () => {
  test("有未完成的 run 时为真", () => {
    expect(hasActiveRun([run({ id: 1, status: "in_progress", conclusion: null })])).toBe(true);
    expect(hasActiveRun([run({ id: 1, status: "queued", conclusion: null })])).toBe(true);
  });

  test("全部完成时为假", () => {
    expect(hasActiveRun([run({ id: 1 }), run({ id: 2 })])).toBe(false);
  });

  test("空列表为假", () => {
    expect(hasActiveRun([])).toBe(false);
  });
});
