import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";

// /api/v1/me 下的接口都要求登录。必须链式定义：Hono RPC 从返回类型推导每个接口。
export const meRoutes = new Hono<AppEnv>().get("/", (c) => {
  const { user } = currentAuth(c);
  return c.json({
    id: user.id,
    name: user.name,
    image: user.image ?? null,
    status: user.status,
    createdAt: user.createdAt,
  });
});
