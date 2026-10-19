CREATE SEQUENCE "public"."chart_list_public_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "chart_library_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"journal_sequence" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_library_states" (
	"key" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"fact" jsonb NOT NULL,
	"journal_sequence" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_library_status" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"ready" boolean DEFAULT true NOT NULL,
	CONSTRAINT "chart_library_status_global" CHECK ("chart_library_status"."id"='global')
);
--> statement-breakpoint
CREATE TABLE "chart_list_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"fact" jsonb NOT NULL,
	"journal_sequence" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_list_public_ids" (
	"list_id" uuid PRIMARY KEY NOT NULL,
	"public_id" bigint NOT NULL,
	CONSTRAINT "chart_list_public_ids_publicId_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "chart_list_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"list_id" uuid NOT NULL,
	"reporter_id" text NOT NULL,
	"category" text NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "chart_list_report_status" CHECK ("chart_list_reports"."status" in ('open','dismissed','actioned'))
);
--> statement-breakpoint
CREATE TABLE "chart_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"public_id" bigint,
	"fact" jsonb NOT NULL,
	"journal_sequence" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "chart_lists_publicId_unique" UNIQUE("public_id"),
	CONSTRAINT "chart_lists_valid" CHECK ("chart_lists"."revision">0 and "chart_lists"."journal_sequence">0)
);
--> statement-breakpoint
ALTER TABLE "storage_tombstones" DROP CONSTRAINT "storage_tombstones_kind_check";--> statement-breakpoint
ALTER TABLE "storage_tombstones" DROP CONSTRAINT "storage_tombstones_subject_check";--> statement-breakpoint
CREATE UNIQUE INDEX "chart_list_reports_list_id_reporter_id_key" ON "chart_list_reports" USING btree ("list_id","reporter_id");--> statement-breakpoint
CREATE INDEX "chart_list_reports_owner_time" ON "chart_list_reports" USING btree ("reporter_id","created_at","id");--> statement-breakpoint
CREATE INDEX "chart_lists_owner_time" ON "chart_lists" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "chart_lists_public_time" ON "chart_lists" USING btree ("published_at","id") WHERE "chart_lists"."public_id" is not null;--> statement-breakpoint
ALTER TABLE "storage_tombstones" ADD CONSTRAINT "storage_tombstones_kind_check" CHECK ("storage_tombstones"."kind" in ('user_deleted','file_deleted','hash_blocked','media_revoked','chart_permission','user_public_id','community_content','private_social','private_library'));--> statement-breakpoint
ALTER TABLE "storage_tombstones" ADD CONSTRAINT "storage_tombstones_subject_check" CHECK (("storage_tombstones"."kind" in ('private_social','private_library') and "storage_tombstones"."payload" is not null) or ("storage_tombstones"."kind" = 'community_content' and "storage_tombstones"."payload" is not null) or ("storage_tombstones"."kind" = 'user_public_id' and "storage_tombstones"."user_id" is not null and "storage_tombstones"."payload" is not null) or ("storage_tombstones"."kind" = 'chart_permission' and "storage_tombstones"."payload" is not null) or ("storage_tombstones"."kind" = 'user_deleted' and "storage_tombstones"."user_id" is not null) or ("storage_tombstones"."kind" = 'file_deleted' and "storage_tombstones"."file_id" is not null) or ("storage_tombstones"."kind" in ('hash_blocked','media_revoked') and "storage_tombstones"."sha256" is not null));
--> statement-breakpoint
INSERT INTO chart_library_status(id) VALUES('global');
