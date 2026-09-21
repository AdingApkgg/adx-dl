import { describe, expect, test } from "bun:test";

import type { JobStep, RunSummary } from "@/shared/dto";

import { formatDuration, runDuration, statusLabel, statusTone, stepDuration } from "./run-format";

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 1, name: "Build", status: "completed", conclusion: "success", event: "push",
    branch: "main", sha: "abc1234", createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:03:12Z", runNumber: 1, htmlUrl: "https://example.test/run",
    ...overrides,
  };
}

describe("statusLabel", () => {
  test("未完成的 run 不看 conclusion", () => {
    expect(statusLabel(run({ status: "in_progress", conclusion: null }))).toBe("进行中");
    expect(statusLabel(run({ status: "queued", conclusion: null }))).toBe("排队中");
  });

  test("完成的 run 按 conclusion 取标签", () => {
    expect(statusLabel(run({ conclusion: "success" }))).toBe("成功");
    expect(statusLabel(run({ conclusion: "failure" }))).toBe("失败");
  });

  test("没见过的 conclusion 原样显示，而不是显示空白", () => {
    // GitHub 以后加了新的 conclusion 值时，界面该露出那个值让人看得见，
    // 而不是安静地渲染成一个空标签。
    expect(statusLabel(run({ conclusion: "brand_new" as RunSummary["conclusion"] }))).toBe("brand_new");
  });
});

describe("statusTone", () => {
  test("超时和失败同色", () => {
    expect(statusTone(run({ conclusion: "failure" }))).toBe("bad");
    expect(statusTone(run({ conclusion: "timed_out" }))).toBe("bad");
  });

  test("取消与跳过是中性的，不该染成失败色", () => {
    expect(statusTone(run({ conclusion: "cancelled" }))).toBe("muted");
    expect(statusTone(run({ conclusion: "skipped" }))).toBe("muted");
  });

  test("未完成是 running", () => {
    expect(statusTone(run({ status: "in_progress", conclusion: null }))).toBe("running");
  });
});

describe("formatDuration", () => {
  test("不足一分钟只显示秒", () => {
    expect(formatDuration(45_000)).toBe("45秒");
  });

  test("超过一分钟显示分和秒", () => {
    expect(formatDuration(192_000)).toBe("3分12秒");
  });

  test("非法值回破折号而不是 NaN", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("runDuration / stepDuration", () => {
  test("按时间戳算时长", () => {
    expect(runDuration(run())).toBe("3分12秒");
  });

  test("时间戳缺失的步骤回破折号", () => {
    const step: JobStep = {
      name: "Build", status: "queued", conclusion: null, number: 1,
      startedAt: null, completedAt: null,
    };

    expect(stepDuration(step)).toBe("—");
  });
});
