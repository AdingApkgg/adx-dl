CREATE TABLE "chart_source_entries" (
  "source_blob_id" uuid NOT NULL REFERENCES "blobs" ("id") ON DELETE RESTRICT,
  "ordinal" integer NOT NULL,
  "path" text NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text NOT NULL,
  "content_blob_id" uuid REFERENCES "blobs" ("id") ON DELETE RESTRICT,
  PRIMARY KEY ("source_blob_id", "ordinal"),
  CONSTRAINT "chart_source_entries_hash_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chart_source_entries_bounds_check" CHECK ("ordinal" BETWEEN 0 AND 127 AND "size" BETWEEN 0 AND 134217728 AND octet_length("path") BETWEEN 1 AND 240),
  CONSTRAINT "chart_source_entries_content_check" CHECK (
    ("content_blob_id" IS NULL AND "size" = 0 AND "sha256" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    OR ("content_blob_id" IS NOT NULL AND "size" > 0 AND "source_blob_id" <> "content_blob_id")
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_source_entries_path_uidx" ON "chart_source_entries" ("source_blob_id", lower("path"));
--> statement-breakpoint
CREATE INDEX "chart_source_entries_content_idx" ON "chart_source_entries" ("content_blob_id");
