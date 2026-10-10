CREATE TABLE "storage_inventory_progress" (
	"policy_id" uuid PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_inventory_cursor_check" CHECK ("storage_inventory_progress"."cursor" is null or char_length("storage_inventory_progress"."cursor") between 1 and 8192)
);
--> statement-breakpoint
CREATE TABLE "storage_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"key" text NOT NULL,
	"size" bigint NOT NULL,
	"observed_etag" text NOT NULL,
	"state" text DEFAULT 'quarantined' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_started_at" timestamp with time zone,
	"delete_uncertain" boolean DEFAULT false NOT NULL,
	CONSTRAINT "storage_quarantine_hash_check" CHECK ("storage_quarantine"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "storage_quarantine_generation_check" CHECK ("storage_quarantine"."generation" >= 0 and "storage_quarantine"."generation" <= 9007199254740991),
	CONSTRAINT "storage_quarantine_size_check" CHECK ("storage_quarantine"."size" between 1 and 480000000),
	CONSTRAINT "storage_quarantine_key_check" CHECK ("storage_quarantine"."key"='sha256/'||substr("storage_quarantine"."sha256",1,2)||'/'||substr("storage_quarantine"."sha256",3,2)||'/'||"storage_quarantine"."sha256"),
	CONSTRAINT "storage_quarantine_etag_check" CHECK (char_length("storage_quarantine"."observed_etag") between 1 and 1024),
	CONSTRAINT "storage_quarantine_state_check" CHECK ("storage_quarantine"."state" in ('quarantined','deleting','deleted')),
	CONSTRAINT "storage_quarantine_delete_check" CHECK ((not "storage_quarantine"."delete_uncertain" or "storage_quarantine"."delete_started_at" is not null) and ("storage_quarantine"."state"<>'deleted' or ("storage_quarantine"."delete_started_at" is not null and not "storage_quarantine"."delete_uncertain")))
);
--> statement-breakpoint
ALTER TABLE "storage_inventory_progress" ADD CONSTRAINT "storage_inventory_progress_policy_id_storage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."storage_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_quarantine" ADD CONSTRAINT "storage_quarantine_policy_id_storage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."storage_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_quarantine_policy_key_uidx" ON "storage_quarantine" USING btree ("policy_id","key");--> statement-breakpoint
CREATE INDEX "storage_quarantine_cleanup_idx" ON "storage_quarantine" USING btree ("state","first_seen_at");