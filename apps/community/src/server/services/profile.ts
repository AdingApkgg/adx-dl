import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { profiles, user } from "../db/schema";

/** 自己的资料：昵称在 user 表，简介和引导页状态在 profiles 表（没有这一行时按默认值）。 */
export type MyProfile = { name: string; bio: string; onboardedAt: Date | null };

export async function getMyProfile(db: Db, userId: string): Promise<MyProfile | null> {
  const [row] = await db
    .select({ name: user.name, bio: profiles.bio, onboardedAt: profiles.onboardedAt })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(user.id, userId));
  return row ? { name: row.name, bio: row.bio ?? "", onboardedAt: row.onboardedAt ?? null } : null;
}

/** 已经规整、校验过的改动（见 api/me.ts）：没给的字段不动。 */
export type ProfileUpdate = { name?: string; bio?: string; onboarded?: true };

export async function updateMyProfile(db: Db, userId: string, update: ProfileUpdate): Promise<void> {
  await db.transaction(async (tx) => {
    // 昵称直接改 user 行：没有 cookie cache 和 secondaryStorage，Better Auth 每次读会话都重新读 user 行，
    // 下一个请求就是新昵称。别在这里碰 email（Better Auth 的 user.update.before 管不到直接写库）。
    if (update.name !== undefined) {
      await tx.update(user).set({ name: update.name }).where(eq(user.id, userId));
    }
    if (update.bio === undefined && !update.onboarded) {
      return;
    }
    const now = new Date();
    // 第一次写入时建行；已经有行就只改给了的字段。引导页的时间只记第一次。
    await tx
      .insert(profiles)
      .values({ userId, bio: update.bio ?? "", onboardedAt: update.onboarded ? now : null })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          ...(update.bio !== undefined ? { bio: update.bio } : {}),
          ...(update.onboarded ? { onboardedAt: sql`coalesce(${profiles.onboardedAt}, ${now})` } : {}),
          updatedAt: now,
        },
      });
  });
}

/**
 * 个人主页（spec 第 10.5 节）的公开资料。正在注销的用户只给出 id 和状态：主页显示"该用户正在注销"，
 * 昵称、简介在冷静期里就不再公开。
 */
export type PublicProfile =
  | { id: string; status: "active"; name: string; image: string | null; bio: string; createdAt: Date }
  | { id: string; status: "pending_deletion" };

export async function getPublicProfile(db: Db, id: string): Promise<PublicProfile | null> {
  const [row] = await db
    .select({
      id: user.id,
      status: user.status,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
      bio: profiles.bio,
    })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(user.id, id));
  if (!row) {
    return null;
  }
  if (row.status === "pending_deletion") {
    return { id: row.id, status: "pending_deletion" };
  }
  return { id: row.id, status: "active", name: row.name, image: row.image, bio: row.bio ?? "", createdAt: row.createdAt };
}
