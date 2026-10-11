CREATE TABLE "chart_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chart_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"source_file_id" uuid,
	"preview_derivative_id" uuid NOT NULL,
	"maidata_md5_base64" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chart_versions_ordinal_check" CHECK ("chart_versions"."ordinal" > 0),
	CONSTRAINT "chart_versions_live_source_check" CHECK ("chart_versions"."deleted_at" is not null or "chart_versions"."source_file_id" is not null),
	CONSTRAINT "chart_versions_md5_check" CHECK ("chart_versions"."maidata_md5_base64" ~ '^[A-Za-z0-9+/]{22}==$')
);
--> statement-breakpoint
CREATE TABLE "charts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"current_version_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "charts_title_check" CHECK (char_length("charts"."title") between 1 and 120),
	CONSTRAINT "charts_artist_check" CHECK (char_length("charts"."artist") <= 120),
	CONSTRAINT "charts_revision_check" CHECK ("charts"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "chart_versions" ADD CONSTRAINT "chart_versions_chart_id_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_versions" ADD CONSTRAINT "chart_versions_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_versions" ADD CONSTRAINT "chart_versions_preview_derivative_id_blob_derivatives_id_fk" FOREIGN KEY ("preview_derivative_id") REFERENCES "public"."blob_derivatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chart_versions_source_file_uidx" ON "chart_versions" USING btree ("source_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_versions_chart_ordinal_uidx" ON "chart_versions" USING btree ("chart_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_versions_chart_id_uidx" ON "chart_versions" USING btree ("chart_id","id");--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_current_version_fk" FOREIGN KEY ("id","current_version_id") REFERENCES "public"."chart_versions"("chart_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charts_owner_updated_idx" ON "charts" USING btree ("owner_id","updated_at","id");
