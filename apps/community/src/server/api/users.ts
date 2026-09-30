import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { isShortId } from "../auth/short-id";
import { jsonError } from "../errors";
import { getPublicProfile } from "../services/profile";

// 公开的用户资料，不要求登录。必须链式定义：Hono RPC 从返回类型推导每个接口。
export const userRoutes = new Hono<AppEnv>().get("/:id", async (c) => {
  const id = c.req.param("id");
  // 格式不对的 id 不去查库，和查不到一样返回 404。
  const profile = isShortId(id) ? await getPublicProfile(c.get("services").db, id) : null;
  if (!profile) {
    return jsonError(c, 404, "NOT_FOUND", "User not found");
  }
  return c.json(profile);
});
