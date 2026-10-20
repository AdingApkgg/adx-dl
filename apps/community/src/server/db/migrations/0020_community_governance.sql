CREATE TABLE governance_appeals (
 id uuid PRIMARY KEY DEFAULT uuidv7(), user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 decision_key text NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'open', revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolution_note text,
 CONSTRAINT governance_appeals_valid CHECK (revision>0 AND char_length(reason) BETWEEN 1 AND 1000 AND
 ((status='open' AND resolved_at IS NULL AND resolution_note IS NULL) OR
 (status IN ('upheld','review_required') AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND char_length(resolution_note) BETWEEN 1 AND 500)))
);
CREATE UNIQUE INDEX governance_appeals_user_decision ON governance_appeals(user_id,decision_key);
CREATE INDEX governance_appeals_status_created ON governance_appeals(status,created_at,id);
CREATE INDEX governance_appeals_user_created ON governance_appeals(user_id,created_at,id);
CREATE TABLE governance_audit_events (
 id uuid PRIMARY KEY DEFAULT uuidv7(), kind text NOT NULL, action text NOT NULL,
 target_type text NOT NULL, target_id text NOT NULL, actor_public_id bigint, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX governance_audit_created ON governance_audit_events(created_at,id);
CREATE INDEX governance_audit_kind_created ON governance_audit_events(kind,created_at,id);
--> statement-breakpoint
-- Minimal transaction-local facts only. Never store reason/body/session/IP. No backfill.
CREATE FUNCTION adxc_governance_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb; actor text; number bigint; k text; a text; t text; target text;
BEGIN
 IF TG_OP='UPDATE' THEN o:=to_jsonb(OLD); END IF;
 -- Snapshot import/journal replay never invents new historical audit entries.
 actor:=nullif(current_setting('adxc.governance_actor',true),'');
 IF actor IS NULL THEN RETURN NEW; END IF;
 IF actor IS NOT NULL THEN SELECT public_id INTO number FROM user_public_ids WHERE user_id=actor; END IF;
 IF TG_TABLE_NAME='discussion_decisions' THEN
  -- Appeal resolution has its own event. Do not create two records for its notification anchor.
  IF n->>'entity'='appeal' THEN RETURN NEW; END IF;
  k:='moderation';a:=n->>'action';t:=n->>'entity';target:=n->>'entity_id';
 ELSIF TG_TABLE_NAME='chart_moderations' THEN
  k:='moderation';a:='hide';t:='chart';target:=n->>'chart_id';number:=(n->>'actor_public_id')::bigint;
 ELSIF TG_TABLE_NAME IN ('chart_reports','discussion_reports','chart_list_reports') THEN
  IF n->>'status'='open' OR n->>'status' IS NOT DISTINCT FROM o->>'status' THEN RETURN NEW; END IF;
  k:='report_resolution';a:=n->>'status';t:=TG_TABLE_NAME;target:=n->>'id';
  IF TG_TABLE_NAME='chart_reports' THEN number:=(n->>'resolver_public_id')::bigint; END IF;
 ELSIF TG_TABLE_NAME='governance_appeals' THEN
  IF n->>'status'='open' OR n->>'status' IS NOT DISTINCT FROM o->>'status' THEN RETURN NEW; END IF;
  k:='appeal_resolution';a:=n->>'status';t:='appeal';target:=n->>'id';
 ELSIF TG_TABLE_NAME='community_notices' THEN
  IF n IS NOT DISTINCT FROM o THEN RETURN NEW; END IF;
  k:='notice';a:=CASE WHEN (n->>'withdrawn')::boolean THEN 'withdraw' WHEN n->'publication' IS DISTINCT FROM o->'publication' AND n->'publication'<>'null'::jsonb THEN 'publish' ELSE 'save' END;t:='notice';target:=n->>'id';
 ELSE
  IF n->>'entity'<>'featured' OR n->'fact' IS NOT DISTINCT FROM o->'fact' THEN RETURN NEW; END IF;
  k:='featured';a:='update';t:='featured';target:=n->>'entity_id';
 END IF;
 INSERT INTO governance_audit_events(kind,action,target_type,target_id,actor_public_id) VALUES(k,a,t,target,number);
 RETURN NEW;
END $$;
CREATE TRIGGER governance_decisions_audit AFTER INSERT ON discussion_decisions FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_chart_moderation_audit AFTER INSERT ON chart_moderations FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_chart_report_audit AFTER UPDATE ON chart_reports FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_discussion_report_audit AFTER UPDATE ON discussion_reports FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_list_report_audit AFTER UPDATE ON chart_list_reports FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_appeal_audit AFTER UPDATE ON governance_appeals FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_notice_audit AFTER INSERT OR UPDATE ON community_notices FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
CREATE TRIGGER governance_featured_audit AFTER INSERT OR UPDATE ON community_content_states FOR EACH ROW EXECUTE FUNCTION adxc_governance_audit();
