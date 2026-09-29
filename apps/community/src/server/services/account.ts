import Bowser from "bowser";
import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";

import { maskQq } from "../auth/qq/sender";
import type { Db } from "../db/client";
import { account, passkey, session } from "../db/schema";

export type LoginAccount =
  | { id: string; provider: "google"; email: string | null; createdAt: Date }
  | { id: string; provider: "qq"; nickname: string | null; maskedQq: string; createdAt: Date };

export type LoginPasskey = { id: string; name: string | null; createdAt: Date | null; lastUsedAt: Date | null };

/** 账号设置页的"登录方式"（spec 第 10.4 节）：平台绑定和通行密钥。 */
export async function listLogins(db: Db, userId: string): Promise<{ accounts: LoginAccount[]; passkeys: LoginPasskey[] }> {
  const [accountRows, passkeyRows] = await Promise.all([
    db
      .select({
        id: account.id,
        providerId: account.providerId,
        accountId: account.accountId,
        providerEmail: account.providerEmail,
        providerNickname: account.providerNickname,
        createdAt: account.createdAt,
      })
      .from(account)
      .where(eq(account.userId, userId))
      .orderBy(asc(account.createdAt)),
    db
      .select({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt })
      .from(passkey)
      .where(eq(passkey.userId, userId))
      .orderBy(asc(passkey.createdAt)),
  ]);
  const accounts = accountRows.flatMap((row): LoginAccount[] => {
    if (row.providerId === "google") {
      return [{ id: row.id, provider: "google", email: row.providerEmail, createdAt: row.createdAt }];
    }
    if (row.providerId === "qq") {
      return [
        {
          id: row.id,
          provider: "qq",
          nickname: row.providerNickname,
          maskedQq: maskQq(row.accountId),
          createdAt: row.createdAt,
        },
      ];
    }
    return [];
  });
  return { accounts, passkeys: passkeyRows };
}

export type DeviceSession = {
  id: string;
  browser: string | null;
  os: string | null;
  country: string | null;
  createdAt: Date;
  /** session.updatedAt：会话一天最多续期一次，所以只精确到天。 */
  lastActiveAt: Date;
  current: boolean;
};

// CF-IPCountry 是两位国家代码；XX 表示判断不出，T1 表示 Tor（调研报告第 7 节），都当作没有。
// 建会话时存之前（src/server/auth/auth.ts）和列设备时读出来都用它。
export function countryOf(value: string | null): string | null {
  return value && /^[A-Z]{2}$/.test(value) && value !== "XX" ? value : null;
}

// 一次请求最多列出的会话数。每个会话都要解析一次 User-Agent，这个上限就限制了一次请求要做的解析量。
// 超出的会话不会消失：仍然能被"退出其他设备"清掉。
const SESSION_LIST_LIMIT = 50;

// 只解析 User-Agent 的前这么多个字符：Bowser 的兜底正则对超长的串是平方级的。session.create.before 存之前
// 已经按同样的上限截过（src/server/auth/auth.ts），这里防的是钩子上线之前就在库里的长行。
const USER_AGENT_PARSE_LIMIT = 1024;

/** 账号设置页的"登录设备"：本人还没过期的会话，最近活跃的在前，最多 50 个（当前会话一定在里面）。令牌不出服务端。 */
export async function listSessions(db: Db, userId: string, currentSessionId: string): Promise<DeviceSession[]> {
  const rows = await db
    .select({
      id: session.id,
      userAgent: session.userAgent,
      country: session.country,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    // 当前会话先入选（页面靠它标出"这台设备"，不能被别的更新的会话挤出去），再按最近活跃取够上限。
    .orderBy(desc(sql`${session.id} = ${currentSessionId}`), desc(session.updatedAt))
    .limit(SESSION_LIST_LIMIT);
  // 入选之后，显示的顺序仍然是最近活跃的在前。
  rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return rows.map((row) => {
    const parsed = row.userAgent ? Bowser.parse(row.userAgent.slice(0, USER_AGENT_PARSE_LIMIT)) : null;
    return {
      id: row.id,
      // Bowser 认不出浏览器时给的是空串（curl、okhttp……），认不出系统时是 undefined：用 || 一起变成 null。
      browser: parsed?.browser.name || null,
      os: parsed?.os.name || null,
      country: countryOf(row.country),
      createdAt: row.createdAt,
      lastActiveAt: row.updatedAt,
      current: row.id === currentSessionId,
    };
  });
}

// 会话只存在 PG 里（本计划"与 spec 的偏离"第 2 条），删掉这一行就立即失效。
export async function revokeSession(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const deleted = await db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  return deleted.length > 0;
}

export async function revokeOtherSessions(db: Db, userId: string, currentSessionId: string): Promise<number> {
  const now = Date.now();
  const deleted = await db
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, currentSessionId)))
    .returning({ id: session.id, expiresAt: session.expiresAt });
  // 已过期的会话也一并删掉（顺便清理），但不计入返回的数量：设备列表里本来就看不到它们。
  return deleted.filter((row) => row.expiresAt.getTime() > now).length;
}
