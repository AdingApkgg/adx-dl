CREATE TABLE "chart_public_ids" (
  "chart_id" uuid PRIMARY KEY NOT NULL,
  "public_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  CONSTRAINT "chart_public_ids_positive_check" CHECK ("public_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_public_ids_public_id_uidx" ON "chart_public_ids" ("public_id");
--> statement-breakpoint
-- Recovery supplies the latest durable identity facts BEFORE old snapshot backfill.
INSERT INTO chart_public_ids(chart_id,public_id) OVERRIDING SYSTEM VALUE
SELECT "chartId","publicId" FROM jsonb_to_recordset(
  coalesce(nullif(current_setting('astrodx.restore_chart_public_ids',true),'')::jsonb,'[]'::jsonb)
) AS f("chartId" uuid,"publicId" bigint) ORDER BY "publicId";
--> statement-breakpoint
SELECT setval('chart_public_ids_public_id_seq',coalesce((SELECT max(public_id) FROM chart_public_ids),1),
  EXISTS(SELECT 1 FROM chart_public_ids));
--> statement-breakpoint
-- Existing publications and known historical publications receive stable IDs in first-publication order.
WITH history AS (
  SELECT chart_id, published_at AS first_at FROM chart_publications
  UNION ALL
  SELECT (payload->>'chartId')::uuid, (payload->'publication'->>'publishedAt')::timestamptz
    FROM storage_tombstones WHERE kind='chart_permission' AND payload->'publication' <> 'null'::jsonb
  UNION ALL
  SELECT (f->>'chartId')::uuid, (f->'publication'->>'publishedAt')::timestamptz
    FROM storage_tombstones CROSS JOIN LATERAL jsonb_array_elements(payload->'retained') f
    WHERE kind='user_deleted'
)
INSERT INTO chart_public_ids(chart_id)
SELECT h.chart_id FROM history h WHERE nullif(current_setting('astrodx.restore_chart_public_ids',true),'') IS NULL AND NOT EXISTS(SELECT 1 FROM chart_public_ids i WHERE i.chart_id=h.chart_id)
GROUP BY h.chart_id ORDER BY min(h.first_at),h.chart_id;
--> statement-breakpoint
-- Export these identity assignments through the existing durable permission barrier before serving them.
WITH facts AS (
  INSERT INTO storage_tombstones(kind,payload)
  SELECT 'chart_permission', jsonb_build_object(
    'version',1,'chartId',i.chart_id,'publicId',i.public_id::text,'revision',coalesce(c.revision,1),
    'publication',CASE WHEN p.chart_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'versionId',p.version_id,'title',p.title,'artist',p.artist,
      'publishedAt',to_char(p.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt',to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END)
  FROM chart_public_ids i LEFT JOIN charts c ON c.id=i.chart_id LEFT JOIN chart_publications p ON p.chart_id=i.chart_id
  WHERE nullif(current_setting('astrodx.restore_chart_public_ids',true),'') IS NULL
  ORDER BY i.public_id
  RETURNING sequence,payload
)
UPDATE charts c SET publication_sequence=f.sequence FROM facts f WHERE c.id=(f.payload->>'chartId')::uuid;
