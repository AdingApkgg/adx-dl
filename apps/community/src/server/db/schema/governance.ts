import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import type { GovernanceAppeal } from "@/shared/governance";
const tz={withTimezone:true} as const;
export const governanceAppeals=pgTable("governance_appeals",{
 id:uuid().primaryKey().default(sql`uuidv7()`),userId:text().notNull().references(()=>user.id,{onDelete:"cascade"}),decisionKey:text().notNull(),reason:text().notNull(),
 status:text().$type<GovernanceAppeal["status"]>().notNull().default("open"),revision:integer().notNull().default(1),createdAt:timestamp(tz).notNull().defaultNow(),resolvedAt:timestamp(tz),resolutionNote:text(),
},t=>[uniqueIndex("governance_appeals_user_decision").on(t.userId,t.decisionKey),index("governance_appeals_status_created").on(t.status,t.createdAt,t.id),index("governance_appeals_user_created").on(t.userId,t.createdAt,t.id),check("governance_appeals_valid",sql`${t.revision}>0 and char_length(${t.reason}) between 1 and 1000 and ((${t.status}='open' and ${t.resolvedAt} is null and ${t.resolutionNote} is null) or (${t.status} in ('upheld','review_required') and ${t.resolvedAt} is not null and char_length(${t.resolutionNote}) between 1 and 500 and ${t.resolutionNote} is not null))`)]);
export const governanceAuditEvents=pgTable("governance_audit_events",{
 id:uuid().primaryKey().default(sql`uuidv7()`),kind:text().notNull(),action:text().notNull(),targetType:text().notNull(),targetId:text().notNull(),actorPublicId:bigint({mode:"bigint"}),createdAt:timestamp(tz).notNull().defaultNow(),
},t=>[index("governance_audit_created").on(t.createdAt,t.id),index("governance_audit_kind_created").on(t.kind,t.createdAt,t.id)]);
