import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

// 配合 onAPIError.throw：better-call 自己把 APIError 变成带原状态和响应头的 Response，
// 只有未知异常向外抛。这里接住它们，避免默认 SERVER_ERROR 日志泄漏 SQL 参数。
export function withSafeAuthErrors(handler: (request: Request) => Promise<Response>, log: Logger) {
  return async (request: Request): Promise<Response> => {
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      const detail = describeError(error);
      // 已知数据库异常已由 describeError 过滤参数；其他 Error 的 message 也可能带请求数据。
      delete detail.message;
      log.error("better_auth_error", detail);
      return Response.json({ code: "INTERNAL", message: "Internal server error" }, { status: 500 });
    }
    if (response.status >= 500) {
      // 有意返回的服务器错误保持原响应，只记状态，不读取响应体或令牌头。
      log.error("better_auth_error", { status: response.status });
    }
    return response;
  };
}
