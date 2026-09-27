// requestId（hono/request-id）和 secureHeadersNonce（hono/secure-headers）这两个变量
// 由各自的中间件通过 ContextVariableMap 声明，这里只放我们自己的。
export type AppEnv = {
  Variables: {
    clientIp: string;
  };
};
