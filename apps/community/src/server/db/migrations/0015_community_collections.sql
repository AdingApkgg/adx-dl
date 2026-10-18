-- Private collections/tickets; public permissions remain governed by the existing publication journal.
CREATE TABLE "chart_favorites" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT uuidv7(),
  "user_id" text NOT NULL,
  "chart_id" uuid NOT NULL,
  "public_id" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "chart_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "chart_favorites_public_id_check" CHECK ("chart_favorites"."public_id">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_favorites_user_chart_uidx" ON "chart_favorites" USING btree ("user_id","chart_id");
--> statement-breakpoint
CREATE INDEX "chart_favorites_user_created_idx" ON "chart_favorites" USING btree ("user_id","created_at","id");
--> statement-breakpoint
CREATE TABLE "chart_reports" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT uuidv7(),
  "reporter_id" text NOT NULL,
  "chart_id" uuid NOT NULL,
  "public_id" bigint NOT NULL,
  "version_id" uuid NOT NULL,
  "title" text NOT NULL,
  "artist" text NOT NULL,
  "category" text NOT NULL,
  "details" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "resolver_public_id" bigint,
  CONSTRAINT "chart_reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "chart_reports_public_id_check" CHECK ("chart_reports"."public_id">0),
  CONSTRAINT "chart_reports_category_check" CHECK ("chart_reports"."category" in ('copyright','inappropriate','broken','other')),
  CONSTRAINT "chart_reports_details_check" CHECK (char_length("chart_reports"."details") between 1 and 500),
  CONSTRAINT "chart_reports_status_check" CHECK ("chart_reports"."status" in ('open','dismissed','actioned')),
  CONSTRAINT "chart_reports_resolution_check" CHECK (("chart_reports"."status"='open' and "chart_reports"."resolved_at" is null and "chart_reports"."resolution_note" is null and "chart_reports"."resolver_public_id" is null) or ("chart_reports"."status"<>'open' and "chart_reports"."resolved_at" is not null and char_length("chart_reports"."resolution_note") between 1 and 500 and "chart_reports"."resolution_note" is not null and "chart_reports"."resolver_public_id">0 and "chart_reports"."resolver_public_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_reports_reporter_version_uidx" ON "chart_reports" USING btree ("reporter_id","chart_id","version_id");
--> statement-breakpoint
CREATE INDEX "chart_reports_reporter_created_idx" ON "chart_reports" USING btree ("reporter_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "chart_reports_status_created_idx" ON "chart_reports" USING btree ("status","created_at","id");
