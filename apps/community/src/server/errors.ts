import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiErrorBody = { error: { code: string; message: string } };

// 接口错误的唯一格式。message 给开发者看；前端和 App 按 code 翻译成用户语言。
export function jsonError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json<ApiErrorBody>({ error: { code, message } }, status);
}
