ALTER TABLE "media_purge_requests" ADD COLUMN "attempt_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_purge_requests" ADD COLUMN "evidence" jsonb;