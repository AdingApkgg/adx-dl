import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";

import { parseBio } from "@/shared/bio";
import { describeError } from "@/shared/describe-error";
import { parseNickname } from "@/shared/nickname";

import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { isRecentLogin } from "../auth/recent-login";
import { jsonError } from "../errors";
import { listLogins, listSessions, revokeOtherSessions, revokeSession } from "../services/account";
import { getMyProfile, type ProfileUpdate, updateMyProfile } from "../services/profile";
import { cancelDeletion, requestDeletion } from "../services/user-deletion";
import { UUID_PATTERN } from "../uuid";

// 请求体的形状，只看类型。长度规则（昵称 1 到 24 个字符、简介最多 300 个字符）在 parseNickname、parseBio：
// 这里不设长度上限，超长的值才会走到它们，得到 NICKNAME_INVALID、BIO_TOO_LONG。请求体的总大小由 app.ts 里
// /api/v1/* 的 bodyLimit 限制。
const profilePatch = z.object({
  name: z.string().optional(),
  bio: z.string().optional(),
  onboarded: z.literal(true).optional(),
});

const deletionRequest = z.object({
  /** 同时删除自己发布的内容；不勾时内容匿名保留（spec 第 10.6 节）。 */
  deleteContent: z.boolean(),
  /** 用户照着输入的自己的用户 id，防手滑。 */
  confirmId: z.string().max(100),
});

// /api/v1/me 下的接口都要求登录。必须链式定义：Hono RPC 从返回类型推导每个接口。
export const meRoutes = new Hono<AppEnv>()
  // 先确认已登录，再校验请求体：没登录的请求一律 401，不管请求体对不对。
  .use(async (c, next) => {
    currentAuth(c);
    await next();
  })
  .get("/", (c) => {
    const { user } = currentAuth(c);
    return c.json({
      id: user.id,
      name: user.name,
      image: user.image ?? null,
      status: user.status,
      createdAt: user.createdAt,
      // 注销提示页用它算剩下几天、判断还能不能撤销；不在注销中时是 null。
      deletionPurgeAt: user.deletionPurgeAt ?? null,
    });
  })
  .get("/profile", async (c) => {
    const { user } = currentAuth(c);
    const profile = await getMyProfile(c.get("services").db, user.id);
    if (!profile) {
      return jsonError(c, 404, "NOT_FOUND", "User not found");
    }
    return c.json(profile);
  })
  // 改昵称、简介，或者记下"引导页看过了"（spec 第 10.5 节、第 10.3 节）。没给的字段不动。
  .patch(
    "/profile",
    validator("json", (value, c) => {
      const parsed = profilePatch.safeParse(value);
      if (!parsed.success) {
        return jsonError(c, 400, "BAD_REQUEST", "Invalid profile update");
      }
      const update: ProfileUpdate = {};
      if (parsed.data.name !== undefined) {
        const name = parseNickname(parsed.data.name);
        if (name === null) {
          return jsonError(c, 400, "NICKNAME_INVALID", "Nicknames need 1 to 24 characters");
        }
        update.name = name;
      }
      if (parsed.data.bio !== undefined) {
        const bio = parseBio(parsed.data.bio);
        if (bio === null) {
          return jsonError(c, 400, "BIO_TOO_LONG", "Bios can have at most 300 characters");
        }
        update.bio = bio;
      }
      if (parsed.data.onboarded) {
        update.onboarded = true;
      }
      return update;
    }),
    async (c) => {
      const { user } = currentAuth(c);
      const { db } = c.get("services");
      await updateMyProfile(db, user.id, c.req.valid("json"));
      const profile = await getMyProfile(db, user.id);
      if (!profile) {
        return jsonError(c, 404, "NOT_FOUND", "User not found");
      }
      return c.json(profile);
    }
  )
  // 发起注销（spec 第 10.6 节）：敏感操作，要求 10 分钟内刚登录过；还要照着输入自己的用户 id。
  .post(
    "/deletion",
    validator("json", (value, c) => {
      const parsed = deletionRequest.safeParse(value);
      if (!parsed.success) {
        return jsonError(c, 400, "BAD_REQUEST", "Invalid deletion request");
      }
      return parsed.data;
    }),
    async (c) => {
      const { user, session } = currentAuth(c);
      if (!isRecentLogin(session.createdAt)) {
        return jsonError(c, 403, "REAUTH_REQUIRED", "Sign in again to continue");
      }
      const { deleteContent, confirmId } = c.req.valid("json");
      if (confirmId !== user.id) {
        return jsonError(c, 400, "DELETION_CONFIRM_MISMATCH", "Type your user ID to confirm");
      }
      const services = c.get("services");
      const result = await requestDeletion(
        { db: services.db, boss: services.boss, handlers: services.deletionHandlers },
        user.id,
        { deleteContent }
      );
      if (result.status === "not_active") {
        return jsonError(c, 403, "ACCOUNT_PENDING_DELETION", "This account is scheduled for deletion");
      }
      if (result.status === "conflict") {
        return jsonError(c, 409, "DELETION_CONFLICT", "A deletion is already being processed");
      }
      // 会话已经在事务里删掉了；事务提交之后再让 Better Auth 发出清掉会话 Cookie 的 Set-Cookie（它不要求
      // 会话还在）。这一步出错不改变结果：注销已经生效，会话行也已经删光，照常返回 200，错误记进日志。
      // 只是响应里没有清除头，浏览器会留着一个不对应任何会话的 Cookie（这次请求恰好要续期的话，是
      // sessionContext 补上的续期头设的那个），服务端不认它。
      const signedOut = await services.auth.api
        .signOut({ headers: c.req.raw.headers, returnHeaders: true })
        .catch((error: unknown) => {
          services.log.error("deletion_sign_out_failed", { userId: user.id, ...describeError(error) });
          return null;
        });
      for (const cookie of signedOut?.headers.getSetCookie() ?? []) {
        c.header("set-cookie", cookie, { append: true });
      }
      // signedOut：这个会话已经失效。App（Bearer）不认 Cookie，看到它就丢掉自己存的令牌。
      return c.json({ purgeAt: result.purgeAt.toISOString(), signedOut: true as const });
    }
  )
  // 撤销注销：冷静期内、还没到清除时间才行（清除任务可能已经开始了）。
  .delete("/deletion", async (c) => {
    const { user } = currentAuth(c);
    if ((await cancelDeletion(c.get("services"), user.id)) === "not_cancellable") {
      return jsonError(c, 409, "DELETION_NOT_CANCELLABLE", "This deletion can no longer be cancelled");
    }
    return c.json({ status: "active" as const });
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
    // uuid 不分大小写，而 session.id 在库里是小写：先转成小写，大写的当前会话 id 才绕不过下面的比较。
    const id = c.req.param("id").toLowerCase();
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
