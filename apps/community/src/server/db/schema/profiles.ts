import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

const tz = { withTimezone: true } as const;

// 和用户一对一的扩展资料（spec 第 9.2 节）。不放进 user 表：Better Auth 每次读会话都会带出整行 user。
// 按需创建：第一次写入时插入；读不到时按默认值处理（简介为空、没看过引导页）。
// 它是用户自己的数据，不是"内容"，所以跟着用户级联删除（内容表的外键才用 SET NULL）。
export const profiles = pgTable("profiles", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // 纯文本，最多 300 个字符，可以有换行（规则在 src/shared/bio.ts）。
  bio: text().default("").notNull(),
  // 首次登录引导页点过"完成"或"以后再说"的时间；之后再打开引导页直接跳走。
  onboardedAt: timestamp(tz),
  createdAt: timestamp(tz).defaultNow().notNull(),
  updatedAt: timestamp(tz)
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// No FK: deleting an account must never make its public URL available to another user.
// Migration 0013 installs the transactional registration trigger and durable journal outbox.
export const userPublicIds = pgTable("user_public_ids", {
  userId: text().primaryKey(),
  publicId: bigint({ mode: "bigint" }).notNull().generatedAlwaysAsIdentity(),
  journalSequence: bigint({ mode: "number" }).notNull().default(0),
}, (t) => [
  uniqueIndex("user_public_ids_public_id_uidx").on(t.publicId),
  check("user_public_ids_positive_check", sql`${t.publicId} > 0`),
  check("user_public_ids_sequence_check", sql`${t.journalSequence} >= 0`),
]);
