import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { meRoutes } from "./me";
import { userRoutes } from "./users";

// 必须链式定义：Hono RPC 从链式调用的返回类型里推导出每个接口的类型。
export const apiV1 = new Hono<AppEnv>()
  .get("/meta", (c) => c.json({ name: "astrodx-community", apiVersion: 1 as const }))
  // 登录页的配置：Turnstile 站点密钥、QQ 登录能不能用。不要求登录。
  .get("/login-options", async (c) => c.json(await c.get("services").loginOptions()))
  .route("/me", meRoutes)
  // 个人主页的公开资料（spec 第 10.5 节），不要求登录。
  .route("/users", userRoutes);

export const apiRoutes = new Hono<AppEnv>().route("/api/v1", apiV1);
