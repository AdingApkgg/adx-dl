import { hc } from "hono/client";

import type { AppType } from "@/server/api/app-type";

export type ApiClient = ReturnType<typeof hc<AppType>>;
export type ApiClientOptions = NonNullable<Parameters<typeof hc<AppType>>[1]>;

export function createApiClient(baseUrl: string, options?: ApiClientOptions): ApiClient {
  return hc<AppType>(baseUrl, options);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ResponseLike = { ok: boolean; status: number; statusText: string; json(): Promise<unknown> };

// 把非 2xx 的响应变成 ApiError，查询函数里 await 它就能让 TanStack Query 拿到错误。
export async function expectOk<R extends ResponseLike>(response: R): Promise<R> {
  if (response.ok) {
    return response;
  }
  let code = `HTTP_${response.status}`;
  let message = response.statusText || "Request failed";
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } } | null;
    if (typeof body?.error?.code === "string") {
      code = body.error.code;
    }
    if (typeof body?.error?.message === "string") {
      message = body.error.message;
    }
  } catch {
    // 响应体不是 JSON，就用状态码。
  }
  throw new ApiError(response.status, code, message);
}
