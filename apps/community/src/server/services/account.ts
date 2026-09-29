import Bowser from "bowser";
import { and, asc, desc, eq, gt, ne } from "drizzle-orm";

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
function countryOf(value: string | null): string | null {
  return value && /^[A-Z]{2}$/.test(value) && value !== "XX" ? value : null;
}

/** 账号设置页的"登录设备"：本人还没过期的会话，最近活跃的在前。令牌不出服务端。 */
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
    .orderBy(desc(session.updatedAt));
  return rows.map((row) => {
    const parsed = row.userAgent ? Bowser.parse(row.userAgent) : null;
    return {
      id: row.id,
      browser: parsed?.browser.name ?? null,
      os: parsed?.os.name ?? null,
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
  const deleted = await db
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, currentSessionId)))
    .returning({ id: session.id });
  return deleted.length;
}
