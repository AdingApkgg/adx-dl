CREATE TABLE "user_public_ids" (
  "user_id" text PRIMARY KEY NOT NULL,
  "public_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "journal_sequence" bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "user_public_ids_positive_check" CHECK ("public_id" > 0),
  CONSTRAINT "user_public_ids_sequence_check" CHECK ("journal_sequence" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_public_ids_public_id_uidx" ON "user_public_ids" ("public_id");
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_kind_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_kind_check CHECK
  (kind IN ('user_deleted','file_deleted','hash_blocked','media_revoked','chart_permission','user_public_id'));
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_subject_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_subject_check CHECK
  ((kind='user_public_id' AND user_id IS NOT NULL AND payload IS NOT NULL) OR
   (kind='chart_permission' AND payload IS NOT NULL) OR (kind='user_deleted' AND user_id IS NOT NULL) OR
   (kind='file_deleted' AND file_id IS NOT NULL) OR (kind IN ('hash_blocked','media_revoked') AND sha256 IS NOT NULL));
--> statement-breakpoint
-- Reserve IDs from the verified external journal before migrating an old database dump.
INSERT INTO user_public_ids(user_id,public_id) OVERRIDING SYSTEM VALUE
SELECT "userId","publicId" FROM jsonb_to_recordset(
  coalesce(nullif(current_setting('astrodx.restore_user_public_ids',true),'')::jsonb,'[]'::jsonb)
) AS f("userId" text,"publicId" bigint) ORDER BY "publicId";
--> statement-breakpoint
SELECT setval('user_public_ids_public_id_seq',coalesce((SELECT max(public_id) FROM user_public_ids),1),
  EXISTS(SELECT 1 FROM user_public_ids));
--> statement-breakpoint
CREATE FUNCTION allocate_user_public_id(subject text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE number bigint; fact bigint;
BEGIN
  -- Same admission barrier as the exporter: a committed later sequence cannot overtake this fact.
  PERFORM pg_advisory_xact_lock_shared(714102026::bigint);
  PERFORM pg_advisory_xact_lock(714102029::bigint);
  SELECT public_id INTO number FROM user_public_ids WHERE user_id=subject;
  IF FOUND THEN RETURN number; END IF;
  LOOP
    number := nextval('user_public_ids_public_id_seq');
    -- Rare legacy all-digit short IDs must remain aliases, never become another user's URL.
    EXIT WHEN NOT EXISTS(SELECT 1 FROM user_public_ids WHERE public_id=number OR user_id=number::text)
      AND NOT EXISTS(SELECT 1 FROM "user" WHERE id=number::text);
  END LOOP;
  INSERT INTO storage_tombstones(kind,user_id,payload) VALUES
    ('user_public_id',subject,jsonb_build_object('version',1,'publicId',number::text)) RETURNING sequence INTO fact;
  INSERT INTO user_public_ids(user_id,public_id,journal_sequence) OVERRIDING SYSTEM VALUE VALUES(subject,number,fact);
  RETURN number;
END;
$$;
--> statement-breakpoint
-- Upgrade backfill is deterministic. Recovery waits until the final deletion replay instead.
DO $$ DECLARE subject record;
BEGIN
  IF nullif(current_setting('astrodx.restore_user_public_ids',true),'') IS NULL THEN
    FOR subject IN SELECT id FROM "user" ORDER BY created_at,id LOOP
      PERFORM allocate_user_public_id(subject.id);
    END LOOP;
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION assign_user_public_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A deleted account's short ID remains reserved too; registration must retry a collision.
  IF EXISTS(SELECT 1 FROM user_public_ids WHERE user_id=NEW.id) THEN
    RAISE unique_violation USING MESSAGE='user identity is permanently reserved';
  END IF;
  PERFORM allocate_user_public_id(NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_assign_public_id AFTER INSERT ON "user"
  FOR EACH ROW EXECUTE FUNCTION assign_user_public_id();
