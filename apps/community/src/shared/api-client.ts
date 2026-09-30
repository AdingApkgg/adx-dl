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

/** 接口出错时的响应体（服务端 jsonError 的格式）。 */
type ErrorBody = { error: { code: string; message: string } };

type JsonOf<R> = R extends { json(): Promise<infer T> } ? T : never;

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

// 非 2xx 抛 ApiError；2xx 返回响应体，类型里去掉错误响应的那一种。jsonError 的状态码参数是个联合类型，
// Hono 从它推不出哪些响应是成功的，res.ok 收窄不掉错误的类型，所以在这里按响应体的形状去掉。
export async function okJson<R extends ResponseLike>(response: R): Promise<Exclude<JsonOf<R>, ErrorBody>> {
  return (await (await expectOk(response)).json()) as Exclude<JsonOf<R>, ErrorBody>;
}
