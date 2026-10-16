-- First moderation decisions intentionally have no cascading foreign keys.
CREATE TABLE "chart_moderations" (
  "chart_id" uuid PRIMARY KEY NOT NULL,
  "public_id" bigint NOT NULL,
  "revision" integer NOT NULL,
  "actor_id" text NOT NULL,
  "actor_public_id" bigint NOT NULL,
  "reason" text NOT NULL,
  "publication" jsonb NOT NULL,
  "author" jsonb,
  "created_at" timestamp with time zone NOT NULL,
  "journal_sequence" bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "chart_moderations_reason_check" CHECK (char_length("reason") between 1 and 500),
  CONSTRAINT "chart_moderations_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "chart_moderations_identity_check" CHECK ("public_id" > 0 and "actor_public_id" > 0 and "journal_sequence" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_moderations_public_id_uidx" ON "chart_moderations" USING btree ("public_id");
--> statement-breakpoint
CREATE TABLE "storage_backup_status" (
  "id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
  "run_id" uuid NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "manifest_sha256" text,
  "original_count" integer,
  "bytes" bigint,
  CONSTRAINT "storage_backup_status_singleton_check" CHECK ("id" = 'global'),
  CONSTRAINT "storage_backup_status_state_check" CHECK ("status" in ('unknown','running','succeeded','failed')),
  CONSTRAINT "storage_backup_status_hash_check" CHECK ("manifest_sha256" is null or "manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "storage_backup_status_counts_check" CHECK (("original_count" is null or "original_count" >= 0) and ("bytes" is null or "bytes" between 0 and 9007199254740991))
);
