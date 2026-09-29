import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { isRecentLogin } from "../auth/recent-login";
import { jsonError } from "../errors";
import { listLogins, listSessions, revokeOtherSessions, revokeSession } from "../services/account";
import { UUID_PATTERN } from "../uuid";

// /api/v1/me 下的接口都要求登录。必须链式定义：Hono RPC 从返回类型推导每个接口。
export const meRoutes = new Hono<AppEnv>()
  .get("/", (c) => {
    const { user } = currentAuth(c);
    return c.json({
      id: user.id,
      name: user.name,
      image: user.image ?? null,
      status: user.status,
      createdAt: user.createdAt,
    });
  })
  .get("/logins", async (c) => {
    const { user } = currentAuth(c);
    return c.json(await listLogins(c.get("services").db, user.id));
  })
  .get("/sessions", async (c) => {
    const { user, session } = currentAuth(c);
    return c.json({ sessions: await listSessions(c.get("services").db, user.id, session.id) });
  })
  // 踢下线（spec 第 10.4 节）：敏感操作，要求 10 分钟内刚登录过。
  .delete("/sessions/:id", async (c) => {
    const { user, session } = currentAuth(c);
    if (!isRecentLogin(session.createdAt)) {
      return jsonError(c, 403, "REAUTH_REQUIRED", "Sign in again to continue");
    }
    const id = c.req.param("id");
    if (id === session.id) {
      return jsonError(c, 400, "CURRENT_SESSION", "Sign out to end the current session");
    }
    if (!UUID_PATTERN.test(id) || !(await revokeSession(c.get("services").db, user.id, id))) {
      return jsonError(c, 404, "NOT_FOUND", "Session not found");
    }
    return c.json({ ok: true as const });
  })
  .post("/sessions/revoke-others", async (c) => {
    const { user, session } = currentAuth(c);
    if (!isRecentLogin(session.createdAt)) {
      return jsonError(c, 403, "REAUTH_REQUIRED", "Sign in again to continue");
    }
    return c.json({ revoked: await revokeOtherSessions(c.get("services").db, user.id, session.id) });
  });
