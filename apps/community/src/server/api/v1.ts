import { Hono } from "hono";

import type { AppEnv } from "../app-env";

// 必须链式定义：Hono RPC 从链式调用的返回类型里推导出每个接口的类型。
export const apiV1 = new Hono<AppEnv>().get("/meta", (c) =>
  c.json({ name: "astrodx-community", apiVersion: 1 as const })
);

export const apiRoutes = new Hono<AppEnv>().route("/api/v1", apiV1);
