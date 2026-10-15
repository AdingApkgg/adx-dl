CREATE TABLE "chart_publications" (
	"chart_id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_tombstones" DROP CONSTRAINT "storage_tombstones_kind_check";--> statement-breakpoint
ALTER TABLE "storage_tombstones" DROP CONSTRAINT "storage_tombstones_subject_check";--> statement-breakpoint
ALTER TABLE "charts" DROP CONSTRAINT "charts_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "charts" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charts" ADD COLUMN "publication_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_tombstones" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "chart_publications" ADD CONSTRAINT "chart_publications_chart_id_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_publications" ADD CONSTRAINT "chart_publication_version_fk" FOREIGN KEY ("chart_id","version_id") REFERENCES "public"."chart_versions"("chart_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chart_publications_updated_idx" ON "chart_publications" USING btree ("updated_at","chart_id");--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_tombstones" ADD CONSTRAINT "storage_tombstones_kind_check" CHECK ("storage_tombstones"."kind" in ('user_deleted','file_deleted','hash_blocked','media_revoked','chart_permission'));--> statement-breakpoint
ALTER TABLE "storage_tombstones" ADD CONSTRAINT "storage_tombstones_subject_check" CHECK (("storage_tombstones"."kind" = 'chart_permission' and "storage_tombstones"."payload" is not null) or ("storage_tombstones"."kind" = 'user_deleted' and "storage_tombstones"."user_id" is not null) or ("storage_tombstones"."kind" = 'file_deleted' and "storage_tombstones"."file_id" is not null) or ("storage_tombstones"."kind" in ('hash_blocked','media_revoked') and "storage_tombstones"."sha256" is not null));