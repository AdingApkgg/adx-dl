CREATE SEQUENCE chart_list_public_id_seq AS bigint START WITH 1;
--> statement-breakpoint
CREATE TABLE chart_lists(id uuid PRIMARY KEY,owner_id text NOT NULL,revision integer NOT NULL,public_id bigint UNIQUE,fact jsonb NOT NULL,journal_sequence bigint NOT NULL,updated_at timestamptz NOT NULL,published_at timestamptz,CONSTRAINT chart_lists_valid CHECK(revision>0 AND journal_sequence>0));
--> statement-breakpoint
CREATE INDEX chart_lists_owner_time ON chart_lists(owner_id,updated_at,id);
--> statement-breakpoint
CREATE INDEX chart_lists_public_time ON chart_lists(published_at,id) WHERE public_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE chart_list_public_ids(list_id uuid PRIMARY KEY,public_id bigint UNIQUE NOT NULL);
--> statement-breakpoint
CREATE TABLE chart_list_controls(id uuid PRIMARY KEY,revision integer NOT NULL,fact jsonb NOT NULL,journal_sequence bigint NOT NULL);
--> statement-breakpoint
CREATE TABLE chart_library_states(key text PRIMARY KEY,revision integer NOT NULL,fact jsonb NOT NULL,journal_sequence bigint NOT NULL);
--> statement-breakpoint
CREATE TABLE chart_library_accounts(user_id text PRIMARY KEY,revision integer NOT NULL,journal_sequence bigint NOT NULL);
--> statement-breakpoint
CREATE TABLE chart_library_status(id text PRIMARY KEY DEFAULT 'global',ready boolean NOT NULL DEFAULT true,CONSTRAINT chart_library_status_global CHECK(id='global'));
--> statement-breakpoint
INSERT INTO chart_library_status(id) VALUES('global');
--> statement-breakpoint
CREATE TABLE chart_list_reports(id uuid PRIMARY KEY DEFAULT uuidv7(),list_id uuid NOT NULL,reporter_id text NOT NULL,category text NOT NULL,details text NOT NULL,status text NOT NULL DEFAULT 'open',created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,resolution_note text,UNIQUE(list_id,reporter_id),CONSTRAINT chart_list_report_status CHECK(status IN('open','dismissed','actioned')));
--> statement-breakpoint
CREATE INDEX chart_list_reports_owner_time ON chart_list_reports(reporter_id,created_at,id);
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_kind_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_kind_check CHECK(kind IN ('user_deleted','file_deleted','hash_blocked','media_revoked','chart_permission','user_public_id','community_content','private_social','private_library'));
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_subject_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_subject_check CHECK((kind IN ('community_content','private_social','private_library') AND payload IS NOT NULL) OR (kind='user_public_id' AND user_id IS NOT NULL AND payload IS NOT NULL) OR (kind='chart_permission' AND payload IS NOT NULL) OR (kind='user_deleted' AND user_id IS NOT NULL) OR (kind='file_deleted' AND file_id IS NOT NULL) OR (kind IN ('hash_blocked','media_revoked') AND sha256 IS NOT NULL));
