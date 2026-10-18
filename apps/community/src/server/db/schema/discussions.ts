import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
const tz = { withTimezone: true } as const;
export const discussionBoards = pgTable("discussion_boards", {
  id: text().primaryKey(), name: text().notNull(), description: text().notNull(), order: integer().notNull(),
  readOnly: boolean().notNull().default(false), revision: integer().notNull().default(1),
}, t => [check("discussion_board_revision", sql`${t.revision}>0`)]);
export const discussionTopics = pgTable("discussion_topics", {
  id: uuid().primaryKey().default(sql`uuidv7()`), authorId: text().references(() => user.id, { onDelete: "set null" }),
  boardId: text().notNull().references(() => discussionBoards.id), title: text(), body: text(), contentHash: text().notNull(),
  revision: integer().notNull().default(1), controlRevision: integer().notNull().default(1), state: text().$type<"visible" | "hidden" | "deleted" | "root_removed">().notNull().default("visible"),
  locked: boolean().notNull().default(false), pin: integer(), linkedChartIds: jsonb().$type<string[]>().notNull().default([]),
  createdAt: timestamp(tz).notNull().defaultNow(), editedAt: timestamp(tz),
}, t => [index("discussion_topics_board_created").on(t.boardId, t.createdAt, t.id), index("discussion_topics_author").on(t.authorId, t.createdAt, t.id), check("discussion_topics_state", sql`${t.state} in ('visible','hidden','deleted','root_removed')`), check("discussion_topics_revision", sql`${t.revision}>0 and ${t.controlRevision}>0`), check("discussion_topics_pin", sql`${t.pin} is null or ${t.pin} between 1 and 3`)]);
export const discussionMessages = pgTable("discussion_messages", {
  id: uuid().primaryKey().default(sql`uuidv7()`), authorId: text().references(() => user.id, { onDelete: "set null" }),
  topicId: uuid().references(() => discussionTopics.id), chartId: uuid(), versionId: uuid(),
  rootId: uuid(), replyToId: uuid(), body: text(), contentHash: text().notNull(), revision: integer().notNull().default(1),
  state: text().$type<"visible" | "hidden" | "deleted">().notNull().default("visible"), difficulty: integer(), timestampMs: integer(),
  createdAt: timestamp(tz).notNull().defaultNow(), editedAt: timestamp(tz),
}, t => [index("discussion_messages_topic_created").on(t.topicId,t.createdAt,t.id), index("discussion_messages_chart_created").on(t.chartId,t.versionId,t.rootId,t.createdAt,t.id), index("discussion_messages_author_created").on(t.authorId,t.createdAt,t.id), check("discussion_messages_context", sql`(${t.topicId} is not null and ${t.chartId} is null and ${t.versionId} is null and ${t.rootId} is null and ${t.difficulty} is null and ${t.timestampMs} is null) or (${t.topicId} is null and ${t.chartId} is not null and ${t.versionId} is not null)`), check("discussion_messages_state", sql`${t.state} in ('visible','hidden','deleted')`), check("discussion_messages_time", sql`(${t.difficulty} is null or ${t.difficulty} between 1 and 7) and (${t.timestampMs} is null or (${t.difficulty} is not null and ${t.timestampMs}>=0))`)]);
export const discussionRequests = pgTable("discussion_requests", {
  id: uuid().primaryKey().default(sql`uuidv7()`), userId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text().notNull(), hash: text().notNull(), entity: text().$type<"topic" | "message">().notNull(), entityId: uuid().notNull(), createdAt: timestamp(tz).notNull().defaultNow(),
}, t => [uniqueIndex("discussion_requests_user_key").on(t.userId,t.key), index("discussion_requests_user_time").on(t.userId,t.createdAt)]);
export const discussionEdits = pgTable("discussion_edits", { id: uuid().primaryKey().default(sql`uuidv7()`), entityId: uuid().notNull(), createdAt: timestamp(tz).notNull().defaultNow() }, t => [index("discussion_edits_entity_time").on(t.entityId,t.createdAt)]);
export const discussionSubscriptions = pgTable("discussion_subscriptions", { id: uuid().primaryKey().default(sql`uuidv7()`), userId: text().notNull().references(() => user.id, { onDelete: "cascade" }), topicId: uuid().notNull().references(() => discussionTopics.id), createdAt: timestamp(tz).notNull().defaultNow() }, t => [uniqueIndex("discussion_subscriptions_user_topic").on(t.userId,t.topicId), index("discussion_subscriptions_topic_user").on(t.topicId,t.userId)]);
export const discussionDecisions = pgTable("discussion_decisions", { id: uuid().primaryKey().default(sql`uuidv7()`), actorId: text().references(() => user.id, { onDelete: "set null" }), recipientId: text().references(() => user.id, { onDelete: "set null" }), entity: text().notNull(), entityId: text().notNull(), action: text().notNull(), reason: text().notNull(), publicReason: text().notNull(), createdAt: timestamp(tz).notNull().defaultNow() });
export const discussionReports = pgTable("discussion_reports", {
  id: uuid().primaryKey().default(sql`uuidv7()`), reporterId: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  targetType: text().$type<"chart_comment" | "forum_topic" | "forum_reply">().notNull(), targetId: uuid().notNull(), targetAuthorId: text().references(() => user.id, { onDelete: "set null" }),
  category: text().$type<"copyright" | "inappropriate" | "broken" | "other">().notNull(), details: text().notNull(),
  evidenceTitle: text(), evidenceBody: text(), evidenceExpiresAt: timestamp(tz).notNull(),
  status: text().$type<"open" | "dismissed" | "actioned">().notNull().default("open"), resolutionNote: text(), resolvedAt: timestamp(tz),
  createdAt: timestamp(tz).notNull().defaultNow(),
}, t => [uniqueIndex("discussion_reports_reporter_target").on(t.reporterId,t.targetType,t.targetId), index("discussion_reports_reporter_created").on(t.reporterId,t.createdAt,t.id), index("discussion_reports_status_created").on(t.status,t.createdAt,t.id), check("discussion_reports_status",sql`${t.status} in ('open','dismissed','actioned')`)]);
export const discussionOutbox = pgTable("discussion_outbox", {
  id: uuid().primaryKey().default(sql`uuidv7()`), actorId: text().references(() => user.id, { onDelete: "set null" }),
  kind: text().$type<"message" | "moderation" | "report_resolution">().notNull(), topicId: uuid(), messageId: uuid(),
  recipientId: text(), decisionId: uuid(), reportId: uuid(), sequence: bigint({mode:"number"}).notNull(), cursor: text(), completed: boolean().notNull().default(false),
  createdAt: timestamp(tz).notNull().defaultNow(),
},t=>[index("discussion_outbox_pending").on(t.completed,t.createdAt,t.id)]);
export const discussionDeliveries = pgTable("discussion_deliveries", { id: uuid().primaryKey().default(sql`uuidv7()`), eventId: uuid().notNull(), userId: text().notNull().references(() => user.id,{onDelete:"cascade"}), createdAt: timestamp(tz).notNull().defaultNow() },t=>[uniqueIndex("discussion_deliveries_event_user").on(t.eventId,t.userId)]);
export const discussionNotifications = pgTable("discussion_notifications", {
  id: uuid().primaryKey().default(sql`uuidv7()`), userId: text().notNull().references(() => user.id,{onDelete:"cascade"}),
  kind: text().$type<"direct_reply" | "chart_comment" | "subscription" | "moderation" | "report_resolution">().notNull(),
  eventId: uuid().notNull(), topicId: uuid(), messageId: uuid(), decisionId: uuid(), reportId: uuid(),
  eventAt: timestamp(tz).notNull(), readAt: timestamp(tz), createdAt: timestamp(tz).notNull().defaultNow(),
},t=>[index("discussion_notifications_user_event").on(t.userId,t.eventAt,t.id), uniqueIndex("discussion_notifications_unread_topic").on(t.userId,t.topicId).where(sql`${t.kind}='subscription' and ${t.readAt} is null`)]);
