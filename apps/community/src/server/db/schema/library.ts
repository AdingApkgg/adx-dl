import {sql} from "drizzle-orm";
import {bigint,boolean,check,index,integer,jsonb,pgTable,text,timestamp,uuid} from "drizzle-orm/pg-core";
import type {PrivateLibraryFact,PrivateListFact,LibraryControlFact} from "@/shared/private-library-journal";
export const chartLists=pgTable("chart_lists",{id:uuid().primaryKey(),ownerId:text().notNull(),revision:integer().notNull(),publicId:bigint({mode:"bigint"}).unique(),fact:jsonb().$type<PrivateListFact>().notNull(),journalSequence:bigint({mode:"number"}).notNull(),updatedAt:timestamp({withTimezone:true}).notNull(),publishedAt:timestamp({withTimezone:true})},t=>[index("chart_lists_owner_time").on(t.ownerId,t.updatedAt,t.id),check("chart_lists_valid",sql`${t.revision}>0 and ${t.journalSequence}>0`)]);
export const chartListControls=pgTable("chart_list_controls",{id:uuid().primaryKey(),revision:integer().notNull(),fact:jsonb().$type<LibraryControlFact>().notNull(),journalSequence:bigint({mode:"number"}).notNull()});
export const chartLibraryStates=pgTable("chart_library_states",{key:text().primaryKey(),revision:integer().notNull(),fact:jsonb().$type<PrivateLibraryFact>().notNull(),journalSequence:bigint({mode:"number"}).notNull()});
export const chartLibraryAccounts=pgTable("chart_library_accounts",{userId:text().primaryKey(),revision:integer().notNull(),journalSequence:bigint({mode:"number"}).notNull()});
export const chartLibraryStatus=pgTable("chart_library_status",{id:text().primaryKey().default("global"),ready:boolean().notNull().default(true)},t=>[check("chart_library_status_global",sql`${t.id}='global'`)]);
