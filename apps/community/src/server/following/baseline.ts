/** Run after verified permission replay too: old dump tails can predate private publication facts. */
export const FOLLOWING_BASELINE_SQL = `WITH history AS (SELECT (payload->>'chartId')::uuid chart_id,(payload->'publication'->>'versionId')::uuid version_id,(payload->'publication'->>'updatedAt')::timestamptz at,sequence
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
FROM hashed f LEFT JOIN charts c ON c.id=f.chart_id ON CONFLICT(chart_id,version_id) DO NOTHING;`;
