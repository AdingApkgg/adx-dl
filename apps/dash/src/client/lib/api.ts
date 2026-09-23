import type {
  BranchSummary,
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

/** 我们自己的写端点全部固定用这个形状的 JSON 应 202：{ accepted: true, ... }。 */
function isAcceptedBody(parsed: unknown): boolean {
  return typeof parsed === "object" && parsed !== null && (parsed as { accepted?: unknown }).accepted === true;
}

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(text.slice(0, 200), res.status);
  }

  // res.ok 只代表状态码落在 2xx，不代表这个响应真的来自我们自己的 API——
  // 如果 Cloudflare Access 把挑战页也编码成某个 2xx（这件事本身无法在
  // 没有真实部署的情况下确认或排除，见 events.ts 同类注释的精神），一个
  // 会话已过期的操作员点「触发/重跑/取消」会看到"已提交，等待 GitHub
  // 接手"，而请求其实从没到达 GitHub——这比 4xx/5xx 误报更危险，因为
  // 界面明确告诉操作员"成功了"。
  //
  // 我们自己的写端点固定回 { accepted: true, ... } 这个形状的 JSON；不是
  // 这个形状就一律当失败处理，不管状态码是不是 2xx。
  //
  // 这个检查能防住的：任何不是我们自己 /api 写端点吐出来的 2xx 响应
  // （Cloudflare 的 HTML 挑战页、别的 JSON 形状、空 body……）。
  // 防不住的：如果某个中间层精确伪造出 { accepted: true } 这个 JSON 形状
  // 又用 2xx 回复——但那已经不是"挑战页恰好是 2xx"这个具体场景了，是另一
  // 类更难防、也不是这次要解决的问题。
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(text.slice(0, 200), res.status);
  }
  if (!isAcceptedBody(parsed)) {
    throw new ApiError(text.slice(0, 200), res.status);
  }
}

export const api = {
  me: () => get<MeResponse>("/api/me"),
  workflows: () => get<WorkflowSummary[]>("/api/workflows"),
  branches: () => get<BranchSummary[]>("/api/branches"),
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
