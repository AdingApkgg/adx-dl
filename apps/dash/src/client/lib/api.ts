import type {
  FailedStepLog,
  MeResponse,
  RunDetail,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    // 后端对 /api 的未命中回的是 JSON，但 Access 会话过期时回的是
    // Cloudflare 的 HTML 登录页 —— 直接 res.json() 会抛一个和真实原因
    // 毫无关系的语法错误。
    const text = await res.text();
    throw new ApiError(text.slice(0, 200), res.status);
  }
  return (await res.json()) as T;
}

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new ApiError((await res.text()).slice(0, 200), res.status);
  }
}

export const api = {
  me: () => get<MeResponse>("/api/me"),
  workflows: () => get<WorkflowSummary[]>("/api/workflows"),
  runs: () => get<RunSummary[]>("/api/runs"),
  run: (runId: number) => get<RunDetail>(`/api/runs/${runId}`),
  failureLog: async (runId: number): Promise<FailedStepLog | null> => {
    const res = await fetch(`/api/runs/${runId}/failure-log`);
    if (res.status === 204) return null;
    if (!res.ok) throw new ApiError((await res.text()).slice(0, 200), res.status);
    return (await res.json()) as FailedStepLog;
  },
  dispatch: (workflowId: number, ref?: string) =>
    post(`/api/workflows/${workflowId}/dispatch`, ref ? { ref } : undefined),
  rerun: (runId: number) => post(`/api/runs/${runId}/rerun`),
  cancel: (runId: number) => post(`/api/runs/${runId}/cancel`),
};

export { ApiError };
