ALTER TABLE charts ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=8);
--> statement-breakpoint
ALTER TABLE chart_publications ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=8);
