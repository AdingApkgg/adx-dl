import type { Db } from "../db/client";
import type { LoginOptions } from "./login-options";

// /api/v1 的接口通过请求上下文拿到的依赖（createApp 挂的中间件负责设置）。
// 路由定义保持模块级的常量，Hono RPC 的类型推导才不受影响。
export type ApiServices = {
  db: Db;
  loginOptions: () => Promise<LoginOptions>;
};
