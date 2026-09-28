import type { AuthSession } from "./auth/auth";

// requestId（hono/request-id）和 secureHeadersNonce（hono/secure-headers）这两个变量
// 由各自的中间件通过 ContextVariableMap 声明，这里只放我们自己的。
export type AppEnv = {
  Variables: {
    clientIp: string;
    /** 当前用户和会话，未登录是 null。只在 /api/v1/* 上由 sessionContext 设置。 */
    auth: AuthSession | null;
  };
};
