import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { PrivateSocialFact } from "@/shared/private-social-journal";
const tz = { withTimezone: true } as const;
// Private rows use active-account joins and bounded orphan cleanup, never unbounded FK fan-out.
export const communityFollows = pgTable("community_follows", {
 id: uuid().primaryKey().default(sql`uuidv7()`), userId: text().notNull(),
 authorId: text().notNull(), revision: integer().notNull(),
 followedAt: timestamp(tz), notifySince: timestamp(tz), updatedAt: timestamp(tz).notNull().defaultNow(),
 journalSequence: bigint({mode:"number"}).notNull(),
}, t => [uniqueIndex("community_follows_pair").on(t.userId,t.authorId),index("community_follows_user_sequence").on(t.userId,t.journalSequence),index("community_follows_author_user").on(t.authorId,t.userId),index("community_follows_user_time").on(t.userId,t.followedAt,t.id),check("community_follows_valid",sql`${t.userId}<>${t.authorId} and ${t.revision}>0 and ${t.journalSequence}>0 and (${t.notifySince} is null or (${t.followedAt} is not null and ${t.notifySince}>=${t.followedAt}))`)]);
// Deliberately no user FK: durable cutoff cannot vanish during purge or an old restore.
export const communityFollowingAccounts = pgTable("community_following_accounts", {
 userId:text().primaryKey(), revision:integer().notNull(), cutoffAt:timestamp(tz).notNull(), journalSequence:bigint({mode:"number"}).notNull(),
},t=>[index("community_following_accounts_sequence").on(t.journalSequence),check("community_following_accounts_valid",sql`${t.revision}>0 and ${t.journalSequence}>0`)]);
// No chart/version FK: an already-public version is never reannounced after deletion or restore.
export const communityPublicationEvents = pgTable("community_publication_events", {
 id:uuid().primaryKey().default(sql`uuidv7()`), chartId:uuid().notNull(), versionId:uuid().notNull(), authorId:text(),
 occurredAt:timestamp(tz).notNull(), permissionSequence:bigint({mode:"number"}).notNull(), journalSequence:bigint({mode:"number"}).notNull(),
 notify:boolean().notNull().default(false), cursor:text(), completed:boolean().notNull().default(false),
},t=>[uniqueIndex("community_publication_events_version").on(t.chartId,t.versionId),index("community_publication_events_pending").on(t.completed,t.occurredAt,t.id),index("community_publication_events_author_time").on(t.authorId,t.occurredAt,t.id),check("community_publication_events_valid",sql`${t.permissionSequence}>=0 and ${t.journalSequence}>=0`)]);
export const communityUpdateNotifications = pgTable("community_update_notifications", {
 id:uuid().primaryKey().default(sql`uuidv7()`), userId:text().notNull(),authorId:text(),
 eventId:uuid().notNull(),eventAt:timestamp(tz).notNull(),createdAt:timestamp(tz).notNull(),readAt:timestamp(tz),revision:integer().notNull(),journalSequence:bigint({mode:"number"}).notNull(),
},t=>[uniqueIndex("community_updates_unread_author").on(t.userId,t.authorId).where(sql`${t.readAt} is null`),index("community_updates_author_time").on(t.userId,t.authorId,t.eventAt,t.eventId),index("community_updates_user_time").on(t.userId,t.eventAt,t.id),check("community_updates_valid",sql`${t.revision}>0 and ${t.journalSequence}>0`)]);
export const communityUpdateDeliveries = pgTable("community_update_deliveries", {
 eventId:uuid().notNull(), userId:text().notNull(),journalSequence:bigint({mode:"number"}).notNull(),
},t=>[primaryKey({columns:[t.eventId,t.userId]}),check("community_update_deliveries_valid",sql`${t.journalSequence}>0`)]);
export const communityPrivateStates = pgTable("community_private_states", {
 key:text().primaryKey(),entity:text().notNull(),revision:integer().notNull(),fact:jsonb().$type<PrivateSocialFact>().notNull(),journalSequence:bigint({mode:"number"}).notNull(),
},t=>[check("community_private_states_valid",sql`${t.revision}>0 and ${t.journalSequence}>0`)]);
export const communityFollowingStatus = pgTable("community_following_status", {
 id:text().primaryKey().default("global"),ready:boolean().notNull().default(true),failures:integer().notNull().default(0),lastSuccessAt:timestamp(tz),lastFailureAt:timestamp(tz),
},t=>[check("community_following_status_valid",sql`${t.id}='global' and ${t.failures}>=0`)]);
