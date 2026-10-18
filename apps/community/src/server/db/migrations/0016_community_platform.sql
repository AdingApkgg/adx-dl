CREATE TABLE community_content_states(key text PRIMARY KEY,entity text NOT NULL,entity_id text NOT NULL,revision integer NOT NULL,fact jsonb NOT NULL,journal_sequence bigint NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT community_content_revision_check CHECK(revision>0 AND journal_sequence>0));
--> statement-breakpoint
CREATE TABLE forum_public_ids(topic_id uuid PRIMARY KEY,public_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,journal_sequence bigint NOT NULL DEFAULT 0,CONSTRAINT forum_public_ids_positive_check CHECK(public_id>0 AND journal_sequence>=0));
--> statement-breakpoint
CREATE UNIQUE INDEX forum_public_ids_public_id_uidx ON forum_public_ids(public_id);
--> statement-breakpoint
CREATE TABLE community_notices(id uuid PRIMARY KEY DEFAULT uuidv7(),revision integer NOT NULL DEFAULT 1,draft jsonb NOT NULL,publication jsonb,publication_hash text,withdrawn boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT community_notices_revision_check CHECK(revision>0));
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_kind_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_kind_check CHECK(kind IN ('user_deleted','file_deleted','hash_blocked','media_revoked','chart_permission','user_public_id','community_content'));
--> statement-breakpoint
ALTER TABLE storage_tombstones DROP CONSTRAINT storage_tombstones_subject_check;
--> statement-breakpoint
ALTER TABLE storage_tombstones ADD CONSTRAINT storage_tombstones_subject_check CHECK((kind='community_content' AND payload IS NOT NULL) OR (kind='user_public_id' AND user_id IS NOT NULL AND payload IS NOT NULL) OR (kind='chart_permission' AND payload IS NOT NULL) OR (kind='user_deleted' AND user_id IS NOT NULL) OR (kind='file_deleted' AND file_id IS NOT NULL) OR (kind IN ('hash_blocked','media_revoked') AND sha256 IS NOT NULL));
--> statement-breakpoint
ALTER TABLE charts ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN credits text NOT NULL DEFAULT '', ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE chart_versions ADD COLUMN release_note text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE chart_publications ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN credits text NOT NULL DEFAULT '', ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN release_note text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE charts ADD CONSTRAINT charts_metadata_length_check CHECK (char_length(description)<=2000 AND char_length(credits)<=1000 AND jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=8);
--> statement-breakpoint
ALTER TABLE chart_versions ADD CONSTRAINT chart_versions_release_note_check CHECK (char_length(release_note)<=1000);
--> statement-breakpoint
ALTER TABLE chart_publications ADD CONSTRAINT chart_publications_metadata_length_check CHECK (char_length(description)<=2000 AND char_length(credits)<=1000 AND char_length(release_note)<=1000 AND jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=8);
--> statement-breakpoint
CREATE INDEX chart_publications_tags_idx ON chart_publications USING gin(tags jsonb_path_ops);
--> statement-breakpoint
CREATE TABLE discussion_boards(id text PRIMARY KEY,name text NOT NULL,description text NOT NULL,"order" integer NOT NULL,read_only boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,CONSTRAINT discussion_board_revision CHECK(revision>0));
--> statement-breakpoint
INSERT INTO discussion_boards(id,name,description,"order") VALUES ('general','综合交流','站点使用、社区讨论',1),('creation','谱面创作','制作经验、Simai 片段、作品交流',2),('feedback','问题反馈','谱面、站点功能和使用问题',3);
--> statement-breakpoint
CREATE TABLE discussion_topics(id uuid PRIMARY KEY DEFAULT uuidv7(),author_id text CONSTRAINT discussion_topics_author_id_user_id_fk REFERENCES "user"(id) ON DELETE SET NULL,board_id text NOT NULL CONSTRAINT discussion_topics_board_id_discussion_boards_id_fk REFERENCES "discussion_boards"(id),title text,body text,content_hash text NOT NULL,revision integer NOT NULL DEFAULT 1,control_revision integer NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'visible',locked boolean NOT NULL DEFAULT false,pin integer,linked_chart_ids jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),edited_at timestamptz,CONSTRAINT discussion_topics_state CHECK(state IN ('visible','hidden','deleted','root_removed')),CONSTRAINT discussion_topics_revision CHECK(revision>0 AND control_revision>0),CONSTRAINT discussion_topics_pin CHECK(pin IS NULL OR pin BETWEEN 1 AND 3));
--> statement-breakpoint
CREATE INDEX discussion_topics_board_created ON discussion_topics(board_id,created_at,id);
--> statement-breakpoint
CREATE INDEX discussion_topics_author ON discussion_topics(author_id,created_at,id);
--> statement-breakpoint
CREATE TABLE discussion_messages(id uuid PRIMARY KEY DEFAULT uuidv7(),author_id text CONSTRAINT discussion_messages_author_id_user_id_fk REFERENCES "user"(id) ON DELETE SET NULL,topic_id uuid CONSTRAINT discussion_messages_topic_id_discussion_topics_id_fk REFERENCES "discussion_topics"(id),chart_id uuid,version_id uuid,root_id uuid,reply_to_id uuid,body text,content_hash text NOT NULL,revision integer NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'visible',difficulty integer,timestamp_ms integer,created_at timestamptz NOT NULL DEFAULT now(),edited_at timestamptz,CONSTRAINT discussion_messages_context CHECK((topic_id IS NOT NULL AND chart_id IS NULL AND version_id IS NULL AND root_id IS NULL AND difficulty IS NULL AND timestamp_ms IS NULL) OR (topic_id IS NULL AND chart_id IS NOT NULL AND version_id IS NOT NULL)),CONSTRAINT discussion_messages_state CHECK(state IN ('visible','hidden','deleted')),CONSTRAINT discussion_messages_time CHECK((difficulty IS NULL OR difficulty BETWEEN 1 AND 7) AND (timestamp_ms IS NULL OR (difficulty IS NOT NULL AND timestamp_ms>=0))));
--> statement-breakpoint
CREATE INDEX discussion_messages_topic_created ON discussion_messages(topic_id,created_at,id);
--> statement-breakpoint
CREATE INDEX discussion_messages_chart_created ON discussion_messages(chart_id,version_id,root_id,created_at,id);
--> statement-breakpoint
CREATE INDEX discussion_messages_author_created ON discussion_messages(author_id,created_at,id);
--> statement-breakpoint
CREATE TABLE discussion_requests(id uuid PRIMARY KEY DEFAULT uuidv7(),user_id text NOT NULL CONSTRAINT discussion_requests_user_id_user_id_fk REFERENCES "user"(id) ON DELETE CASCADE,key text NOT NULL,hash text NOT NULL,entity text NOT NULL,entity_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE UNIQUE INDEX discussion_requests_user_key ON discussion_requests(user_id,key);
--> statement-breakpoint
CREATE INDEX discussion_requests_user_time ON discussion_requests(user_id,created_at);
--> statement-breakpoint
CREATE TABLE discussion_edits(id uuid PRIMARY KEY DEFAULT uuidv7(),entity_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX discussion_edits_entity_time ON discussion_edits(entity_id,created_at);
--> statement-breakpoint
CREATE TABLE discussion_subscriptions(id uuid PRIMARY KEY DEFAULT uuidv7(),user_id text NOT NULL CONSTRAINT discussion_subscriptions_user_id_user_id_fk REFERENCES "user"(id) ON DELETE CASCADE,topic_id uuid NOT NULL CONSTRAINT discussion_subscriptions_topic_id_discussion_topics_id_fk REFERENCES "discussion_topics"(id),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE UNIQUE INDEX discussion_subscriptions_user_topic ON discussion_subscriptions(user_id,topic_id);
--> statement-breakpoint
CREATE INDEX discussion_subscriptions_topic_user ON discussion_subscriptions(topic_id,user_id);
--> statement-breakpoint
CREATE TABLE discussion_decisions(id uuid PRIMARY KEY DEFAULT uuidv7(),actor_id text CONSTRAINT discussion_decisions_actor_id_user_id_fk REFERENCES "user"(id) ON DELETE SET NULL,recipient_id text CONSTRAINT discussion_decisions_recipient_id_user_id_fk REFERENCES "user"(id) ON DELETE SET NULL,entity text NOT NULL,entity_id text NOT NULL,action text NOT NULL,reason text NOT NULL,public_reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE discussion_reports(id uuid PRIMARY KEY DEFAULT uuidv7(),reporter_id text NOT NULL CONSTRAINT discussion_reports_reporter_id_user_id_fk REFERENCES "user"(id) ON DELETE CASCADE,target_type text NOT NULL,target_id uuid NOT NULL,target_author_id text CONSTRAINT discussion_reports_target_author_id_user_id_fk REFERENCES "user"(id) ON DELETE SET NULL,category text NOT NULL,details text NOT NULL,evidence_title text,evidence_body text,evidence_expires_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'open',resolution_note text,resolved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT discussion_reports_status CHECK(status IN ('open','dismissed','actioned')));
--> statement-breakpoint
CREATE UNIQUE INDEX discussion_reports_reporter_target ON discussion_reports(reporter_id,target_type,target_id);
--> statement-breakpoint
CREATE INDEX discussion_reports_reporter_created ON discussion_reports(reporter_id,created_at,id);
--> statement-breakpoint
CREATE INDEX discussion_reports_status_created ON discussion_reports(status,created_at,id);
--> statement-breakpoint
CREATE TABLE discussion_outbox(id uuid PRIMARY KEY DEFAULT uuidv7(),actor_id text CONSTRAINT discussion_outbox_actor_id_user_id_fk REFERENCES "user"(id) ON DELETE SET NULL,kind text NOT NULL,topic_id uuid,message_id uuid,recipient_id text,decision_id uuid,report_id uuid,sequence bigint NOT NULL,cursor text,completed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX discussion_outbox_pending ON discussion_outbox(completed,created_at,id);
--> statement-breakpoint
CREATE TABLE discussion_deliveries(id uuid PRIMARY KEY DEFAULT uuidv7(),event_id uuid NOT NULL,user_id text NOT NULL CONSTRAINT discussion_deliveries_user_id_user_id_fk REFERENCES "user"(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE UNIQUE INDEX discussion_deliveries_event_user ON discussion_deliveries(event_id,user_id);
--> statement-breakpoint
CREATE TABLE discussion_notifications(id uuid PRIMARY KEY DEFAULT uuidv7(),user_id text NOT NULL CONSTRAINT discussion_notifications_user_id_user_id_fk REFERENCES "user"(id) ON DELETE CASCADE,kind text NOT NULL,event_id uuid NOT NULL,topic_id uuid,message_id uuid,decision_id uuid,report_id uuid,event_at timestamptz NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX discussion_notifications_user_event ON discussion_notifications(user_id,event_at,id);
--> statement-breakpoint
CREATE UNIQUE INDEX discussion_notifications_unread_topic ON discussion_notifications(user_id,topic_id) WHERE kind='subscription' AND read_at IS NULL;
