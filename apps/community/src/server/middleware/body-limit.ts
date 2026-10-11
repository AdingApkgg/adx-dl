import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";

// 选项和 Hono 的 bodyLimit 一样，但只限制声明了请求体的请求：带 Content-Length 或 Transfer-Encoding。HTTP/1.1 的
// 请求两个头都没有就没有请求体（RFC 9112 第 6.3 节），这样的请求原样放行。开发服务器里 @hono/node-server 的请求垫片
// 对没有请求体的 DELETE 也给一个空的请求体流，bodyLimit 见到有请求体流又没有长度，就读空它、换一个新的 Request，
// 新 Request 丢了方法，DELETE 变成 GET。
export function bodyLimitWhenDeclared(options: Parameters<typeof bodyLimit>[0]): MiddlewareHandler {
  const limit = bodyLimit(options);
  return async (c, next) => {
    const { headers } = c.req.raw;
    if (!headers.has("content-length") && !headers.has("transfer-encoding")) {
      await next();
      return;
    }
    return limit(c, next);
  };
}

/** Always count actual bytes; a declared length is not a trusted stream bound. */
export async function readUploadPartBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared === null) throw new HTTPException(411, { message: "Content-Length is required" });
  if (!/^(0|[1-9][0-9]*)$/.test(declared))
    throw new HTTPException(400, { message: "Invalid Content-Length" });
  const length = Number(declared);
  if (!Number.isSafeInteger(length) || length > 4194304)
    throw new HTTPException(413, { message: "Request body is too large" });
  const buffer = new Uint8Array(4194304);
  const reader = request.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > buffer.length) {
          void reader.cancel().catch(() => {});
          throw new HTTPException(413, { message: "Request body is too large" });
        }
        buffer.set(value, size);
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
  }
  if (size !== length)
    throw new HTTPException(400, { message: "Content-Length does not match body" });
  return buffer.subarray(0, size);
}
