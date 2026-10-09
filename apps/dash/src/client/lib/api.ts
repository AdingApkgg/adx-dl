import type {
  BranchSummary,
  ContentCommitRequest,
  ContentCommitResult,
  ContentFileMeta,
  ContentFileResponse,
  FailedStepLog,
  MeResponse,
  RunDetail,
  RunSummary,
  WorkflowSummary,
} from "@/shared/dto";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 服务端 JSON body 里除 error 外的额外字段（errors / step / conflictPaths 等）。 */
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 把一个失败响应的 body 文本变成一个 ApiError。
 *
 * 先按 JSON 解析：成功且是对象，就把整个对象当 detail（供表单读 errors /
 * step / conflictPaths 之类的额外字段——Task 7 的提交冲突界面全靠它们），
 * 并优先用它的 `error` 字段做 message。解析失败，或解析出来不是对象（比如
 * Access 会话过期时回的 Cloudflare HTML 登录页，直接 JSON.parse 会抛一个和
 * 真实原因毫无关系的语法错误），就退回原来的做法：截前 200 字符当 message，
 * detail 留空对象。
 *
 * get() 和 post()/postJson() 的错误分支都走这里，保证两条路径拿到 detail 的
 * 方式一致。
 */
function toApiError(text: string, status: number): ApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new ApiError(text.slice(0, 200), status);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return new ApiError(text.slice(0, 200), status);
  }
  const detail = parsed as Record<string, unknown>;
  const message = typeof detail.error === "string" ? detail.error : text.slice(0, 200);
  return new ApiError(message, status, detail);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    // 后端对 /api 的未命中回的是 JSON，但 Access 会话过期时回的是
    // Cloudflare 的 HTML 登录页 —— 直接 res.json() 会抛一个和真实原因
    // 毫无关系的语法错误，所以这里先拿文本，交给 toApiError 自己判断。
    const text = await res.text();
    throw toApiError(text, res.status);
  }
  return (await res.json()) as T;
}

/** 我们自己的写端点全部固定用这个形状的 JSON 应 202：{ accepted: true, ... }。 */
function isAcceptedBody(parsed: unknown): boolean {
  return typeof parsed === "object" && parsed !== null && (parsed as { accepted?: unknown }).accepted === true;
}

/**
 * 写端点的公共出口。res.ok 之外还要求 body 是 `{ accepted: true, ... }` ——
 * 理由见下面的长注释。返回解析后的 body，好让需要回值的端点（比如内容提交
 * 要拿到 commitSha）能用上，同时保持那道检查只有一处。
 */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw toApiError(text, res.status);
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
    throw toApiError(text, res.status);
  }
  if (!isAcceptedBody(parsed)) {
    throw toApiError(text, res.status);
  }
  return parsed as T;
}

async function post(path: string, body?: unknown): Promise<void> {
  await postJson<unknown>(path, body);
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
    if (!res.ok) throw toApiError(await res.text(), res.status);
    return (await res.json()) as FailedStepLog;
  },
  dispatch: (workflowId: number, ref?: string) =>
    post(`/api/workflows/${workflowId}/dispatch`, ref ? { ref } : undefined),
  rerun: (runId: number) => post(`/api/runs/${runId}/rerun`),
  cancel: (runId: number) => post(`/api/runs/${runId}/cancel`),
  contentFiles: () => get<ContentFileMeta[]>("/api/content"),
  contentFile: (key: string) => get<ContentFileResponse>(`/api/content/${encodeURIComponent(key)}`),
  commitContent: (request: ContentCommitRequest) =>
    postJson<{ accepted: true } & ContentCommitResult>("/api/content/commit", request),
};

export { ApiError };
