import {sql} from "drizzle-orm";
import {integer,jsonb,pgTable,timestamp,uuid,boolean,check,text} from "drizzle-orm/pg-core";
import type {NoticeDraft,NoticePublication} from "@/shared/community-site";
export const communityNotices=pgTable("community_notices",{
 id:uuid().primaryKey().default(sql`uuidv7()`),revision:integer().notNull().default(1),draft:jsonb().$type<NoticeDraft>().notNull(),
 publication:jsonb().$type<NoticePublication>(),publicationHash:text(),withdrawn:boolean().notNull().default(false),createdAt:timestamp({withTimezone:true}).notNull().defaultNow(),
},t=>[check("community_notices_revision_check",sql`${t.revision}>0`)]);
