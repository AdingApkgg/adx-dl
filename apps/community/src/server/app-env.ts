import type { AuthSession } from "./auth/auth";
import type { ApiServices } from "./services/api-services";

// requestId（hono/request-id）和 secureHeadersNonce（hono/secure-headers）这两个变量
// 由各自的中间件通过 ContextVariableMap 声明，这里只放我们自己的。
export type AppEnv = {
  Variables: {
    clientIp: string;
    /** 当前用户和会话，未登录是 null。只在 /api/v1/* 上由 sessionContext 设置。 */
    auth: AuthSession | null;
    /** /api/v1 的依赖；只在 /api/v1/* 上设置。 */
    services: ApiServices;
    /**
     * 服务端渲染时 loader 经进程内 API 调接口，接口响应里的 Set-Cookie（会话续期）收在这里，
     * 由 createApp 里的中间件补到页面响应上。只在页面请求上由 getLoadContext 设置。
     */
    inProcessSetCookies: string[];
  };
};
