CREATE TABLE community_follows(id uuid PRIMARY KEY DEFAULT uuidv7(),user_id text NOT NULL,author_id text NOT NULL,revision integer NOT NULL,followed_at timestamptz,notify_since timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),journal_sequence bigint NOT NULL,CONSTRAINT community_follows_valid CHECK(user_id<>author_id AND revision>0 AND journal_sequence>0 AND (notify_since IS NULL OR (followed_at IS NOT NULL AND notify_since>=followed_at))));
--> statement-breakpoint
CREATE UNIQUE INDEX community_follows_pair ON community_follows(user_id,author_id);
--> statement-breakpoint
CREATE INDEX community_follows_user_sequence ON community_follows(user_id,journal_sequence);
--> statement-breakpoint
CREATE INDEX community_follows_author_user ON community_follows(author_id,user_id);
--> statement-breakpoint
CREATE INDEX community_follows_user_time ON community_follows(user_id,followed_at,id);
--> statement-breakpoint
CREATE TABLE community_following_accounts(user_id text PRIMARY KEY,revision integer NOT NULL,cutoff_at timestamptz NOT NULL,journal_sequence bigint NOT NULL,CONSTRAINT community_following_accounts_valid CHECK(revision>0 AND journal_sequence>0));
--> statement-breakpoint
CREATE INDEX community_following_accounts_sequence ON community_following_accounts(journal_sequence);
--> statement-breakpoint
CREATE TABLE community_publication_events(id uuid PRIMARY KEY DEFAULT uuidv7(),chart_id uuid NOT NULL,version_id uuid NOT NULL,author_id text,occurred_at timestamptz NOT NULL,permission_sequence bigint NOT NULL,journal_sequence bigint NOT NULL,notify boolean NOT NULL DEFAULT false,cursor text,completed boolean NOT NULL DEFAULT false,CONSTRAINT community_publication_events_valid CHECK(permission_sequence>=0 AND journal_sequence>=0));
--> statement-breakpoint
CREATE UNIQUE INDEX community_publication_events_version ON community_publication_events(chart_id,version_id);
--> statement-breakpoint
CREATE INDEX community_publication_events_pending ON community_publication_events(completed,occurred_at,id);
--> statement-breakpoint
CREATE INDEX community_publication_events_author_time ON community_publication_events(author_id,occurred_at,id);
--> statement-breakpoint
CREATE TABLE community_update_notifications(id uuid PRIMARY KEY DEFAULT uuidv7(),user_id text NOT NULL,author_id text,event_id uuid NOT NULL,event_at timestamptz NOT NULL,created_at timestamptz NOT NULL,read_at timestamptz,revision integer NOT NULL,journal_sequence bigint NOT NULL,CONSTRAINT community_updates_valid CHECK(revision>0 AND journal_sequence>0));
--> statement-breakpoint
CREATE UNIQUE INDEX community_updates_unread_author ON community_update_notifications(user_id,author_id) WHERE read_at IS NULL;
--> statement-breakpoint
CREATE INDEX community_updates_author_time ON community_update_notifications(user_id,author_id,event_at,event_id);
--> statement-breakpoint
CREATE INDEX community_updates_user_time ON community_update_notifications(user_id,event_at,id);
--> statement-breakpoint
CREATE TABLE community_update_deliveries(event_id uuid NOT NULL,user_id text NOT NULL,journal_sequence bigint NOT NULL,PRIMARY KEY(event_id,user_id),CONSTRAINT community_update_deliveries_valid CHECK(journal_sequence>0));
--> statement-breakpoint
CREATE TABLE community_private_states(key text PRIMARY KEY,entity text NOT NULL,revision integer NOT NULL,fact jsonb NOT NULL,journal_sequence bigint NOT NULL,CONSTRAINT community_private_states_valid CHECK(revision>0 AND journal_sequence>0));
--> statement-breakpoint
CREATE TABLE community_following_status(id text PRIMARY KEY DEFAULT 'global',ready boolean NOT NULL DEFAULT true,failures integer NOT NULL DEFAULT 0,last_success_at timestamptz,last_failure_at timestamptz,CONSTRAINT community_following_status_valid CHECK(id='global' AND failures>=0));
--> statement-breakpoint
INSERT INTO community_following_status(id) VALUES('global');
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_kind_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_kind_check CHECK(kind IN ('user_deleted','file_deleted','hash_blocked','media_revoked','chart_permission','user_public_id','community_content','private_social'));
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_subject_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_subject_check CHECK((kind IN ('community_content','private_social') AND payload IS NOT NULL) OR (kind='user_public_id' AND user_id IS NOT NULL AND payload IS NOT NULL) OR (kind='chart_permission' AND payload IS NOT NULL) OR (kind='user_deleted' AND user_id IS NOT NULL) OR (kind='file_deleted' AND file_id IS NOT NULL) OR (kind IN ('hash_blocked','media_revoked') AND sha256 IS NOT NULL));
--> statement-breakpoint
-- Permission facts have existed since public publication was introduced. Only this
-- trusted history and current public rows seed the baseline; private versions never do.
WITH history AS (
 SELECT (payload->>'chartId')::uuid chart_id,(payload->'publication'->>'versionId')::uuid version_id,(payload->'publication'->>'updatedAt')::timestamptz at,sequence
 FROM storage_tombstones WHERE kind='chart_permission' AND payload->'publication' IS NOT NULL AND payload->'publication'<>'null'::jsonb
 UNION ALL
 SELECT p.chart_id,p.version_id,p.updated_at,c.publication_sequence FROM chart_publications p JOIN charts c ON c.id=p.chart_id
), firsts AS (
 SELECT chart_id,version_id,min(at) at,min(sequence) sequence FROM history GROUP BY chart_id,version_id
), hashed AS (
 SELECT f.*,md5(f.chart_id::text||'/'||f.version_id::text) h FROM firsts f
)
INSERT INTO community_publication_events(id,chart_id,version_id,author_id,occurred_at,permission_sequence,journal_sequence,notify,completed)
SELECT (substr(h,1,12)||'5'||substr(h,14,3)||'a'||substr(h,18,15))::uuid,f.chart_id,f.version_id,c.owner_id,f.at,f.sequence,0,false,true
FROM hashed f LEFT JOIN charts c ON c.id=f.chart_id ON CONFLICT(chart_id,version_id) DO NOTHING;
