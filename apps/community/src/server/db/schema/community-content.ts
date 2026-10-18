import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { CommunityContentFact } from "@/shared/community-content-journal";
const tz = { withTimezone: true } as const;
export const communityContentStates = pgTable("community_content_states", {
  key: text().primaryKey(), entity: text().notNull(), entityId: text().notNull(), revision: integer().notNull(),
  fact: jsonb().$type<CommunityContentFact>().notNull(), journalSequence: bigint({mode:"number"}).notNull(),
  updatedAt: timestamp(tz).notNull().defaultNow(),
}, t => [check("community_content_revision_check",sql`${t.revision}>0 and ${t.journalSequence}>0`)]);
// No topic FK: a shared or withdrawn numeric URL is never recycled after restore/purge.
export const forumPublicIds = pgTable("forum_public_ids", {
  topicId: uuid().primaryKey(), publicId: bigint({mode:"bigint"}).notNull().generatedAlwaysAsIdentity(),
  journalSequence: bigint({mode:"number"}).notNull().default(0),
}, t => [uniqueIndex("forum_public_ids_public_id_uidx").on(t.publicId),check("forum_public_ids_positive_check",sql`${t.publicId}>0 and ${t.journalSequence}>=0`)]);
