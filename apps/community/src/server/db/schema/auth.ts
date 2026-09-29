// Better Auth 的五张表（spec 第 9.2 节）。以 Better Auth 1.7.6 的命令行输出为底稿手改：
// 时间一律 timestamptz；除 user 外的 id 由数据库 uuidv7() 生成；补了两个唯一索引。
// 属性名必须等于 Better Auth 的字段名（camelCase），物理列名交给 drizzle 的 casing: "snake_case"。
// 往这些表加列：列必须可空或带默认值，并同步改 src/server/auth/fields.ts（或对应插件的
// schema）。Better Auth 启动时会逐列比对，对不上时所有认证请求都会失败。
// 注意 user 是 PG 的保留字：Drizzle 会自动加引号，手写 SQL 时要写成 "user"。
import { relations, sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;

export const user = pgTable("user", {
  // 10 位短 id，由 databaseHooks.user.create.before 生成（src/server/auth/auth.ts）。
  id: text().primaryKey(),
  name: text().notNull(),
  // 一律是 <id>@placeholder.invalid：Better Auth 规定 email 必填且唯一，我们不存任何平台的邮箱。
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  // 头像，子项目 2 之前一律为空。
  image: text(),
  createdAt: timestamp(tz).defaultNow().notNull(),
  updatedAt: timestamp(tz)
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  // 注销相关的四列在 1c 用上（spec 第 10.6 节）。
  status: text({ enum: ["active", "pending_deletion"] })
    .default("active")
    .notNull(),
  deletionRequestedAt: timestamp(tz),
  deletionPurgeAt: timestamp(tz),
  deletionDeleteContent: boolean(),
  // 语言偏好，跟着语言切换一起做，1b 不写。
  locale: text(),
});

export const session = pgTable(
  "session",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    expiresAt: timestamp(tz).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp(tz).defaultNow().notNull(),
    updatedAt: timestamp(tz)
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text(),
    userAgent: text(),
    // 登录时的 CF-IPCountry，登录设备列表显示用。
    country: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = pgTable(
  "account",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    // Google 的 sub 或 QQ 号。
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 以下六列是 Better Auth 的标准字段。我们不存第三方令牌，也没有密码登录，始终为空。
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp(tz),
    refreshTokenExpiresAt: timestamp(tz),
    scope: text(),
    password: text(),
    createdAt: timestamp(tz).defaultNow().notNull(),
    updatedAt: timestamp(tz)
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // 显示用的附属信息：Google 邮箱、QQ 昵称（spec 第 9.2 节）。
    providerEmail: text(),
    providerNickname: text(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    // Better Auth 自己不建这个唯一约束；两个请求同时绑同一个 QQ 时靠它兜底。
    uniqueIndex("account_provider_account_uidx").on(t.providerId, t.accountId),
  ]
);

export const verification = pgTable(
  "verification",
  {
    // 用 text：Better Auth 的 reserveVerificationValue 会写入不是 uuid 的主键（我们暂时用不到）。
    id: text().primaryKey().default(sql`uuidv7()::text`),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp(tz).notNull(),
    createdAt: timestamp(tz).defaultNow().notNull(),
    updatedAt: timestamp(tz)
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

export const passkey = pgTable(
  "passkey",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    name: text(),
    publicKey: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 通行密钥插件的字段名是 credentialID，默认的蛇形转换会变成 credential_i_d，所以写明列名。
    // 插件自己只对同一个用户排除重复，全表唯一靠这里。
    credentialID: text("credential_id").notNull().unique(),
    counter: integer().notNull(),
    deviceType: text().notNull(),
    backedUp: boolean().notNull(),
    transports: text(),
    createdAt: timestamp(tz).defaultNow(),
    aaguid: text(),
    // 插件没有这个字段，由 accountRules 插件加（src/server/auth/account-rules.ts）。
    lastUsedAt: timestamp(tz),
  },
  (t) => [index("passkey_user_id_idx").on(t.userId)]
);

// Better Auth 开了 joins（advanced.database.joins）：读会话时用一条 SQL 连带取出用户，需要这些 relations。
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  passkeys: many(passkey),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, { fields: [passkey.userId], references: [user.id] }),
}));
