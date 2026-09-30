import type { PgBoss } from "pg-boss";

import type { Db } from "../db/client";
import type { LoginOptions } from "./login-options";

// /api/v1 的接口通过请求上下文拿到的依赖（createApp 挂的中间件负责设置）。
// 路由定义保持模块级的常量，Hono RPC 的类型推导才不受影响。
export type ApiServices = {
  db: Db;
  /** pg-boss 的发送端。第一次调用时才启动（失败的启动不缓存），所以是返回 Promise 的函数。 */
  boss: () => Promise<PgBoss>;
  loginOptions: () => Promise<LoginOptions>;
};
