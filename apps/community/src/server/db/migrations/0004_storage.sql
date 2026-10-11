CREATE TABLE "avatar_mutations" (
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"result_image" text,
	"result_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatar_mutations_user_id_idempotency_key_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "avatar_mutations_digest_check" CHECK ("avatar_mutations"."request_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "avatar_mutations_revision_check" CHECK ("avatar_mutations"."result_revision" >= 0 and "avatar_mutations"."result_revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "blob_blocks" (
	"sha256" text PRIMARY KEY NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blob_blocks_hash_check" CHECK ("blob_blocks"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "blob_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source_blob_id" uuid NOT NULL,
	"recipe" text NOT NULL,
	"recipe_build" text NOT NULL,
	"derived_object_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blob_derivatives_state_check" CHECK ("blob_derivatives"."state" in ('pending','ready','rejected','retired')),
	CONSTRAINT "blob_derivatives_ready_check" CHECK ("blob_derivatives"."state" <> 'ready' or "blob_derivatives"."derived_object_id" is not null),
	CONSTRAINT "blob_derivatives_generation_check" CHECK ("blob_derivatives"."generation" >= 0 and "blob_derivatives"."generation" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha256" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"key" text NOT NULL,
	"size" bigint NOT NULL,
	"detected_mime" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"orphaned_at" timestamp with time zone,
	"generation" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blobs_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "blobs_sha256_check" CHECK ("blobs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "blobs_size_check" CHECK ("blobs"."size" > 0 and "blobs"."size" <= 480000000),
	CONSTRAINT "blobs_generation_check" CHECK ("blobs"."generation" >= 0 and "blobs"."generation" <= 9007199254740991),
	CONSTRAINT "blobs_state_check" CHECK ("blobs"."state" in ('pending','ready','deleting','deleted','blocked')),
	CONSTRAINT "blobs_ready_verified_check" CHECK ("blobs"."state" <> 'ready' or ("blobs"."verified_at" is not null and "blobs"."detected_mime" is not null))
);
--> statement-breakpoint
CREATE TABLE "derived_objects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"output_sha256" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"key" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"orphaned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derived_objects_outputSha256_unique" UNIQUE("output_sha256"),
	CONSTRAINT "derived_objects_hash_check" CHECK ("derived_objects"."output_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "derived_objects_size_check" CHECK ("derived_objects"."size" > 0 and "derived_objects"."size" <= 480000000),
	CONSTRAINT "derived_objects_generation_check" CHECK ("derived_objects"."generation" >= 0 and "derived_objects"."generation" <= 9007199254740991),
	CONSTRAINT "derived_objects_state_check" CHECK ("derived_objects"."state" in ('pending','ready','deleting','deleted','blocked'))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" text,
	"blob_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"purpose" text NOT NULL,
	"size" bigint NOT NULL,
	"state" text DEFAULT 'processing' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retained_until" timestamp with time zone,
	CONSTRAINT "files_size_check" CHECK ("files"."size" > 0 and "files"."size" <= 480000000),
	CONSTRAINT "files_state_check" CHECK ("files"."state" in ('processing','ready','rejected','deleted')),
	CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('avatar','chart-source')),
	CONSTRAINT "files_name_check" CHECK (char_length("files"."original_name") between 1 and 255 and "files"."original_name" !~ '[[:cntrl:]/]' and position(chr(92) in "files"."original_name") = 0 and "files"."original_name" not in ('.','..')),
	CONSTRAINT "files_deleted_check" CHECK (("files"."state" = 'deleted') = ("files"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "media_publications" (
	"output_sha256" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'private' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_purge_at" timestamp with time zone,
	CONSTRAINT "media_publications_hash_check" CHECK ("media_publications"."output_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_publications_state_check" CHECK ("media_publications"."state" in ('public','revoking','private','blocked')),
	CONSTRAINT "media_publications_generation_check" CHECK ("media_publications"."generation" >= 0 and "media_publications"."generation" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "media_purge_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"output_sha256" text NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_purge_requests_hash_check" CHECK ("media_purge_requests"."output_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_purge_requests_generation_check" CHECK ("media_purge_requests"."generation" >= 0 and "media_purge_requests"."generation" <= 9007199254740991),
	CONSTRAINT "media_purge_requests_attempts_check" CHECK ("media_purge_requests"."attempts" >= 0),
	CONSTRAINT "media_purge_requests_state_check" CHECK ("media_purge_requests"."state" in ('pending','running','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "storage_budget" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"temporary_reserved" bigint DEFAULT 0 NOT NULL,
	"temporary_written" bigint DEFAULT 0 NOT NULL,
	"original_reserved" bigint DEFAULT 0 NOT NULL,
	"original_written" bigint DEFAULT 0 NOT NULL,
	"derived_reserved" bigint DEFAULT 0 NOT NULL,
	"derived_written" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_budget_singleton_check" CHECK ("storage_budget"."id" = 'global'),
	CONSTRAINT "storage_budget_bytes_0_check" CHECK ("storage_budget"."temporary_reserved" >= 0 and "storage_budget"."temporary_reserved" <= 9007199254740991),
	CONSTRAINT "storage_budget_bytes_1_check" CHECK ("storage_budget"."temporary_written" >= 0 and "storage_budget"."temporary_written" <= 9007199254740991),
	CONSTRAINT "storage_budget_bytes_2_check" CHECK ("storage_budget"."original_reserved" >= 0 and "storage_budget"."original_reserved" <= 9007199254740991),
	CONSTRAINT "storage_budget_bytes_3_check" CHECK ("storage_budget"."original_written" >= 0 and "storage_budget"."original_written" <= 9007199254740991),
	CONSTRAINT "storage_budget_bytes_4_check" CHECK ("storage_budget"."derived_reserved" >= 0 and "storage_budget"."derived_reserved" <= 9007199254740991),
	CONSTRAINT "storage_budget_bytes_5_check" CHECK ("storage_budget"."derived_written" >= 0 and "storage_budget"."derived_written" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "storage_journal_progress" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"exported_sequence" bigint DEFAULT 0 NOT NULL,
	"chain_hash" text,
	"exported_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_journal_progress_singleton_check" CHECK ("storage_journal_progress"."id" = 'global'),
	CONSTRAINT "storage_journal_progress_sequence_check" CHECK ("storage_journal_progress"."exported_sequence" >= 0 and "storage_journal_progress"."exported_sequence" <= 9007199254740991),
	CONSTRAINT "storage_journal_progress_hash_check" CHECK ("storage_journal_progress"."chain_hash" is null or "storage_journal_progress"."chain_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "storage_journal_progress_checkpoint_check" CHECK (("storage_journal_progress"."exported_sequence" = 0 and "storage_journal_progress"."chain_hash" is null and "storage_journal_progress"."exported_at" is null) or ("storage_journal_progress"."exported_sequence" > 0 and "storage_journal_progress"."chain_hash" is not null and "storage_journal_progress"."exported_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "storage_maintenance" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"owner_id" uuid,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_maintenance_singleton_check" CHECK ("storage_maintenance"."id" = 'global'),
	CONSTRAINT "storage_maintenance_lease_check" CHECK (("storage_maintenance"."owner_id" is null) = ("storage_maintenance"."lease_until" is null))
);
--> statement-breakpoint
CREATE TABLE "storage_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"driver" text DEFAULT 's3' NOT NULL,
	"endpoint" text NOT NULL,
	"region" text NOT NULL,
	"original_bucket" text NOT NULL,
	"derived_bucket" text NOT NULL,
	"credentials_ref" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_policies_name_unique" UNIQUE("name"),
	CONSTRAINT "storage_policies_driver_check" CHECK ("storage_policies"."driver" = 's3'),
	CONSTRAINT "storage_policies_credentials_ref_check" CHECK ("storage_policies"."credentials_ref" ~ '^[A-Z][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "storage_tombstones" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "storage_tombstones_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"user_id" text,
	"file_id" uuid,
	"sha256" text,
	"generation" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_tombstones_kind_check" CHECK ("storage_tombstones"."kind" in ('user_deleted','file_deleted','hash_blocked','media_revoked')),
	CONSTRAINT "storage_tombstones_subject_check" CHECK (("storage_tombstones"."kind" = 'user_deleted' and "storage_tombstones"."user_id" is not null) or ("storage_tombstones"."kind" = 'file_deleted' and "storage_tombstones"."file_id" is not null) or ("storage_tombstones"."kind" in ('hash_blocked','media_revoked') and "storage_tombstones"."sha256" is not null)),
	CONSTRAINT "storage_tombstones_hash_check" CHECK ("storage_tombstones"."sha256" is null or "storage_tombstones"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "storage_tombstones_generation_check" CHECK ("storage_tombstones"."generation" is null or ("storage_tombstones"."generation" >= 0 and "storage_tombstones"."generation" <= 9007199254740991))
);
--> statement-breakpoint
CREATE TABLE "storage_usage" (
	"user_id" text PRIMARY KEY NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"active_uploads" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_usage_used_check" CHECK ("storage_usage"."used_bytes" >= 0 and "storage_usage"."used_bytes" <= 9007199254740991),
	CONSTRAINT "storage_usage_reserved_check" CHECK ("storage_usage"."reserved_bytes" >= 0 and "storage_usage"."reserved_bytes" <= 9007199254740991),
	CONSTRAINT "storage_usage_active_check" CHECK ("storage_usage"."active_uploads" >= 0)
);
--> statement-breakpoint
CREATE TABLE "upload_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"upload_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"policy_id" uuid NOT NULL,
	"temp_key" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text,
	"state" text DEFAULT 'writing' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"written_bytes" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_attempts_index_check" CHECK ("upload_attempts"."index" between 0 and 114),
	CONSTRAINT "upload_attempts_size_check" CHECK ("upload_attempts"."size" between 1 and 4194304),
	CONSTRAINT "upload_attempts_state_check" CHECK ("upload_attempts"."state" in ('writing','ready','deleting','deleted')),
	CONSTRAINT "upload_attempts_hash_check" CHECK ("upload_attempts"."sha256" is null or "upload_attempts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_attempts_generation_check" CHECK ("upload_attempts"."generation" >= 0 and "upload_attempts"."generation" <= 9007199254740991),
	CONSTRAINT "upload_attempts_accounting_check" CHECK ("upload_attempts"."reserved_bytes" between 0 and "upload_attempts"."size" and "upload_attempts"."written_bytes" between 0 and "upload_attempts"."size")
);
--> statement-breakpoint
CREATE TABLE "upload_parts" (
	"upload_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"temp_key" text NOT NULL,
	"state" text DEFAULT 'writing' NOT NULL,
	"attempt_id" uuid NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_parts_upload_id_index_pk" PRIMARY KEY("upload_id","index"),
	CONSTRAINT "upload_parts_hash_check" CHECK ("upload_parts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_parts_state_check" CHECK ("upload_parts"."state" in ('writing','ready')),
	CONSTRAINT "upload_parts_size_check" CHECK ("upload_parts"."size" between 1 and 4194304),
	CONSTRAINT "upload_parts_index_check" CHECK ("upload_parts"."index" between 0 and 114)
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" text NOT NULL,
	"purpose" text NOT NULL,
	"original_name" text NOT NULL,
	"expected_sha256" text NOT NULL,
	"expected_size" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"part_count" integer NOT NULL,
	"state" text DEFAULT 'receiving' NOT NULL,
	"file_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"error_code" text,
	"flow_job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_digest" text NOT NULL,
	CONSTRAINT "upload_sessions_state_check" CHECK ("upload_sessions"."state" in ('receiving','processing','ready','rejected','cancelled','expired')),
	CONSTRAINT "upload_sessions_hash_check" CHECK ("upload_sessions"."expected_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_sessions_digest_check" CHECK ("upload_sessions"."request_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_sessions_size_check" CHECK ("upload_sessions"."expected_size" between 1 and 480000000),
	CONSTRAINT "upload_sessions_parts_check" CHECK ("upload_sessions"."part_size" = 4194304 and "upload_sessions"."part_count" between 1 and 115 and "upload_sessions"."part_count" = ("upload_sessions"."expected_size" + "upload_sessions"."part_size" - 1) / "upload_sessions"."part_size"),
	CONSTRAINT "upload_sessions_purpose_check" CHECK ("upload_sessions"."purpose" in ('avatar','chart-source')),
	CONSTRAINT "upload_sessions_name_check" CHECK (char_length("upload_sessions"."original_name") between 1 and 255 and "upload_sessions"."original_name" !~ '[[:cntrl:]/]' and position(chr(92) in "upload_sessions"."original_name") = 0 and "upload_sessions"."original_name" not in ('.','..')),
	CONSTRAINT "upload_sessions_generation_check" CHECK ("upload_sessions"."generation" >= 0 and "upload_sessions"."generation" <= 9007199254740991),
	CONSTRAINT "upload_sessions_reservation_check" CHECK ("upload_sessions"."reserved_bytes" between 0 and "upload_sessions"."expected_size")
);
--> statement-breakpoint
CREATE TABLE "user_avatars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"file_id" uuid,
	"derivative_id" uuid,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	CONSTRAINT "user_avatars_pair_check" CHECK (("user_avatars"."file_id" is null) = ("user_avatars"."derivative_id" is null)),
	CONSTRAINT "user_avatars_revision_check" CHECK ("user_avatars"."revision" >= 0 and "user_avatars"."revision" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "avatar_mutations" ADD CONSTRAINT "avatar_mutations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_derivatives" ADD CONSTRAINT "blob_derivatives_source_blob_id_blobs_id_fk" FOREIGN KEY ("source_blob_id") REFERENCES "public"."blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_derivatives" ADD CONSTRAINT "blob_derivatives_derived_object_id_derived_objects_id_fk" FOREIGN KEY ("derived_object_id") REFERENCES "public"."derived_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_policy_id_storage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."storage_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derived_objects" ADD CONSTRAINT "derived_objects_policy_id_storage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."storage_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_publications" ADD CONSTRAINT "media_publications_output_sha256_derived_objects_output_sha256_fk" FOREIGN KEY ("output_sha256") REFERENCES "public"."derived_objects"("output_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage" ADD CONSTRAINT "storage_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_attempts" ADD CONSTRAINT "upload_attempts_policy_id_storage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."storage_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_upload_id_upload_sessions_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_attempt_id_upload_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."upload_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_derivative_id_blob_derivatives_id_fk" FOREIGN KEY ("derivative_id") REFERENCES "public"."blob_derivatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_mutations_retention_idx" ON "avatar_mutations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_derivatives_recipe_uidx" ON "blob_derivatives" USING btree ("source_blob_id","recipe","recipe_build");--> statement-breakpoint
CREATE INDEX "blob_derivatives_object_idx" ON "blob_derivatives" USING btree ("derived_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blobs_policy_key_uidx" ON "blobs" USING btree ("policy_id","key");--> statement-breakpoint
CREATE INDEX "blobs_gc_idx" ON "blobs" USING btree ("state","orphaned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "derived_objects_policy_key_uidx" ON "derived_objects" USING btree ("policy_id","key");--> statement-breakpoint
CREATE INDEX "derived_objects_gc_idx" ON "derived_objects" USING btree ("state","orphaned_at");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "files_blob_idx" ON "files" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "files_retention_idx" ON "files" USING btree ("state","retained_until");--> statement-breakpoint
CREATE UNIQUE INDEX "media_purge_requests_generation_uidx" ON "media_purge_requests" USING btree ("output_sha256","generation");--> statement-breakpoint
CREATE INDEX "media_purge_requests_retry_idx" ON "media_purge_requests" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_attempts_policy_key_uidx" ON "upload_attempts" USING btree ("policy_id","temp_key");--> statement-breakpoint
CREATE INDEX "upload_attempts_upload_idx" ON "upload_attempts" USING btree ("upload_id","index");--> statement-breakpoint
CREATE INDEX "upload_attempts_cleanup_idx" ON "upload_attempts" USING btree ("state","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_parts_attempt_uidx" ON "upload_parts" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_idempotency_uidx" ON "upload_sessions" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "upload_sessions_expiry_idx" ON "upload_sessions" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_file_idx" ON "upload_sessions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "user_avatars_file_idx" ON "user_avatars" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "user_avatars_derivative_idx" ON "user_avatars" USING btree ("derivative_id");--> statement-breakpoint
INSERT INTO "storage_budget" ("id") VALUES ('global');
--> statement-breakpoint
INSERT INTO "storage_maintenance" ("id") VALUES ('global');
--> statement-breakpoint
INSERT INTO "storage_journal_progress" ("id") VALUES ('global');
--> statement-breakpoint
-- Physical state and source relationship remain independently generated. Deferred checks
-- allow the worker to set both ready in one transaction, while row locks prevent a
-- concurrent retirement from leaving a ready relationship pointing at unavailable bytes.
CREATE FUNCTION "storage_check_ready_derivative"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE physical_state text;
BEGIN
  IF TG_TABLE_NAME = 'blob_derivatives' THEN
    IF NOT EXISTS (SELECT 1 FROM blob_derivatives WHERE id = NEW.id AND state = 'ready') THEN RETURN NULL; END IF;
    SELECT o.state INTO physical_state FROM derived_objects o
      JOIN blob_derivatives d ON d.derived_object_id = o.id
      WHERE d.id = NEW.id FOR SHARE OF o;
    IF physical_state IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'ready derivative requires ready physical object' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM derived_objects WHERE id = NEW.id AND state <> 'ready')
      AND EXISTS (SELECT 1 FROM blob_derivatives WHERE derived_object_id = NEW.id AND state = 'ready') THEN
      RAISE EXCEPTION 'physical object still has ready derivatives' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "blob_derivatives_ready_object"
  AFTER INSERT OR UPDATE ON "blob_derivatives" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "storage_check_ready_derivative"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "derived_objects_ready_relationships"
  AFTER UPDATE ON "derived_objects" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "storage_check_ready_derivative"();
--> statement-breakpoint
CREATE FUNCTION "storage_tombstone_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'storage tombstones are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "storage_tombstones_immutable"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "storage_tombstones"
  FOR EACH STATEMENT EXECUTE FUNCTION "storage_tombstone_append_only"();
