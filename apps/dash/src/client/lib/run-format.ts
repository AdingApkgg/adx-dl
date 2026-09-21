import type { JobStep, RunSummary } from "@/shared/dto";

const CONCLUSION_LABELS: Record<string, string> = {
  success: "成功",
  failure: "失败",
  cancelled: "已取消",
  skipped: "已跳过",
  timed_out: "超时",
  action_required: "需要处理",
  neutral: "中性",
  stale: "已过期",
};

export function statusLabel(run: RunSummary): string {
  if (run.status !== "completed") {
    return run.status === "in_progress" ? "进行中" : "排队中";
  }
  return CONCLUSION_LABELS[run.conclusion ?? ""] ?? run.conclusion ?? "完成";
}

export type StatusTone = "ok" | "bad" | "running" | "muted";

export function statusTone(run: RunSummary): StatusTone {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "ok";
  if (run.conclusion === "failure" || run.conclusion === "timed_out") return "bad";
  return "muted";
}

/** 把毫秒格式化成「3分12秒」。非有限值或负数一律回 "—"。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

export function runDuration(run: RunSummary): string {
  return formatDuration(new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime());
}

export function stepDuration(step: JobStep): string {
  if (!step.startedAt || !step.completedAt) return "—";
  return formatDuration(new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime());
}
