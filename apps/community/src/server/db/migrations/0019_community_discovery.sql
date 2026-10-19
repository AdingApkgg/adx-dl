ALTER TABLE charts ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=8);
--> statement-breakpoint
ALTER TABLE chart_publications ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=8);
--> statement-breakpoint
CREATE FUNCTION public.adxc_canonical_jsonb(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.adxc_canonical_jsonb(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(public.adxc_canonical_jsonb(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord);
 WHEN 'number' THEN result:=to_jsonb((v#>>'{}')::double precision)::text;
 ELSE result:=v::text;
 END CASE;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_text_key(v text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT translate(btrim(regexp_replace(normalize(v,NFKC), U&'[\0009-\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]+', ' ', 'g')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_u16len(v text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT char_length(v)+char_length(regexp_replace(v,U&'[^\+010000-\+10FFFF]','','g')) $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_keys(v jsonb, allowed text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF; RETURN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE NOT k=ANY(allowed)); END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_jstr(v jsonb, maxlen integer) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(jsonb_typeof(v)='string' AND public.adxc_u16len(v#>>'{}')<=maxlen,false) $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_jint(v jsonb, low numeric, high numeric) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE n numeric;
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RETURN false; END IF; n:=(v#>>'{}')::numeric; RETURN n=trunc(n) AND n>=low AND n<=high; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_summary_valid(s jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE d jsonb; a jsonb; seen integer[]:='{}'; n integer;
BEGIN
 IF (public.adxc_keys(s,ARRAY['title','artist','maidataMd5Base64','difficulties','warnings','audio','hasCover']) AND public.adxc_jstr(s->'title',120) AND public.adxc_jstr(s->'artist',120) AND (s->>'maidataMd5Base64')~'^[A-Za-z0-9+/]{22}==$' AND jsonb_typeof(s->'hasCover')='boolean' AND jsonb_typeof(s->'difficulties')='array' AND jsonb_typeof(s->'warnings')='array') IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(s->'difficulties') NOT BETWEEN 1 AND 7 OR jsonb_array_length(s->'warnings')>64 THEN RETURN false; END IF;
 FOR d IN SELECT * FROM jsonb_array_elements(s->'difficulties') LOOP
  IF (public.adxc_keys(d,ARRAY['difficulty','level','designer','noteCount','durationMs','previewSupported']) AND public.adxc_jint(d->'difficulty',1,7) AND (d->'level'='null'::jsonb OR public.adxc_jstr(d->'level',120)) AND (NOT d?'designer' OR public.adxc_jstr(d->'designer',240)) AND (d->'noteCount'='null'::jsonb OR public.adxc_jint(d->'noteCount',0,100000)) AND (d->'durationMs'='null'::jsonb OR public.adxc_jint(d->'durationMs',0,3600000)) AND jsonb_typeof(d->'previewSupported')='boolean') IS NOT TRUE THEN RETURN false; END IF;
  n:=(d->>'difficulty')::integer; IF n=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,n);
  IF d->>'previewSupported'='true' AND (d->'noteCount'='null'::jsonb OR d->'durationMs'='null'::jsonb) THEN RETURN false; END IF;
 END LOOP;
 FOR d IN SELECT * FROM jsonb_array_elements(s->'warnings') LOOP
  IF (public.adxc_keys(d,ARRAY['code','difficulty','line']) AND jsonb_typeof(d->'code')='string' AND (d->>'code')~'^[A-Z][A-Z0-9_]{0,63}$' AND (NOT d?'difficulty' OR public.adxc_jint(d->'difficulty',1,7)) AND (NOT d?'line' OR public.adxc_jint(d->'line',1,1048576))) IS NOT TRUE THEN RETURN false; END IF;
 END LOOP;
 a:=s->'audio';
 IF (a='null'::jsonb OR (public.adxc_keys(a,ARRAY['mime','size']) AND a->>'mime'=ANY(ARRAY['audio/mpeg','audio/ogg','audio/wav']) AND public.adxc_jint(a->'size',1,33554432))) IS NOT TRUE THEN RETURN false; END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_manifest_valid(m jsonb, artifact_size bigint, md5 text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE a jsonb; s jsonb; role integer; previous integer:=-1; off bigint:=0; path text; has_audio boolean:=false; has_cover boolean:=false; bytes integer;
BEGIN
 IF (public.adxc_keys(m,ARRAY['format','assets','summary']) AND m->'format'='1'::jsonb AND jsonb_typeof(m->'assets')='array' AND public.adxc_summary_valid(m->'summary') AND m->'summary'->>'maidataMd5Base64'=md5) IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(m->'assets') NOT BETWEEN 1 AND 3 THEN RETURN false; END IF;
 s:=m->'summary';
 FOR a IN SELECT * FROM jsonb_array_elements(m->'assets') LOOP
  IF (public.adxc_keys(a,ARRAY['role','path','mime','size','sha256','offset']) AND jsonb_typeof(a->'role')='string' AND jsonb_typeof(a->'path')='string' AND jsonb_typeof(a->'mime')='string' AND public.adxc_jint(a->'size',1,33554432) AND public.adxc_jint(a->'offset',off,off) AND jsonb_typeof(a->'sha256')='string' AND (a->>'sha256')~'^[a-f0-9]{64}$') IS NOT TRUE THEN RETURN false; END IF;
  role:=array_position(ARRAY['maidata','audio','cover'],a->>'role')-1;
  IF role IS NULL OR role<=previous OR (previous<0 AND role<>0) THEN RETURN false; END IF; previous:=role;
  path:=a->>'path';
  IF path<>normalize(path,NFC) OR octet_length(path)>240 OR cardinality(string_to_array(path,'/'))>8 OR EXISTS(SELECT 1 FROM unnest(string_to_array(path,'/')) p WHERE p IN ('','.','..')) OR strpos(path,chr(92))>0 OR path~U&'[\0001-\001f\007f-\009f]' OR path~'^[a-zA-Z]:' THEN RETURN false; END IF;
  IF role=0 AND ((a->>'size')::bigint>1048576 OR a->>'mime'<>'text/plain; charset=utf-8') THEN RETURN false; END IF;
  IF role=1 THEN
   IF (s->'audio'<>'null'::jsonb AND a->>'mime'=s->'audio'->>'mime' AND a->'size'=s->'audio'->'size') IS NOT TRUE THEN RETURN false; END IF; has_audio:=true;
  END IF;
  IF role=2 THEN
   IF (s->>'hasCover'='true' AND (a->>'size')::bigint<=1048576 AND a->>'mime'='image/jpeg') IS NOT TRUE THEN RETURN false; END IF; has_cover:=true;
  END IF;
  off:=off+(a->>'size')::bigint;
 END LOOP;
 IF has_audio IS DISTINCT FROM (s->'audio'<>'null'::jsonb) OR has_cover IS DISTINCT FROM (s->>'hasCover'='true') THEN RETURN false; END IF;
 bytes:=octet_length(public.adxc_canonical_jsonb(m));
 RETURN coalesce(bytes<=32768 AND artifact_size BETWEEN 12 AND 50331648 AND artifact_size=12+bytes+off,false);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_public_number(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN RETURN coalesce(jsonb_typeof(v)='string' AND (v#>>'{}')~'^[1-9][0-9]{0,18}$' AND (v#>>'{}')::numeric<=9223372036854775807,false); EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(jsonb_typeof(v)='string' AND (v#>>'{}')~*'^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',false) $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_datetime(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$' THEN RETURN false; END IF; PERFORM (v#>>'{}')::timestamptz; RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_library_text(v jsonb, minimum integer, maximum integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF; t:=v#>>'{}';
 IF char_length(t) NOT BETWEEN minimum AND maximum OR t<>regexp_replace(t,U&'^[\0009-\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]+|[\0009-\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]+$','','g') THEN RETURN false; END IF;
 RETURN t!~U&'[\0001-\0009\000b-\001f\007f-\009f\00ad\0600-\0605\061c\06dd\070f\0890-\0891\08e2\180e\200b-\200f\202a-\202e\2060-\2064\2066-\206f\feff\fff9-\fffb\+0110bd\+0110cd\+013430-\+01343f\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0001\+0e0020-\+0e007f]';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_library_draft(d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE ids jsonb;
BEGIN
 IF (public.adxc_keys(d,ARRAY['name','description','chartIds']) AND public.adxc_library_text(d->'name',1,60) AND public.adxc_library_text(d->'description',0,500) AND jsonb_typeof(d->'chartIds')='array') IS NOT TRUE THEN RETURN false; END IF; ids:=d->'chartIds';
 RETURN jsonb_array_length(ids)<=200 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ids) i WHERE NOT public.adxc_uuid(i)) AND (SELECT count(DISTINCT i) FROM jsonb_array_elements(ids) i)=jsonb_array_length(ids);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_community_fact_valid(f jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE c jsonb; k text;
BEGIN
 IF (public.adxc_keys(f,ARRAY['version','entity','id','revision','state','hash','authorId','publicId','controls']) AND f->'version'='1'::jsonb AND f->>'entity'=ANY(ARRAY['message','topic','notice','topic_control','board_control','forum_id','featured']) AND public.adxc_jstr(f->'id',128) AND (f->>'id')~'^[a-zA-Z0-9_:.-]+$' AND public.adxc_jint(f->'revision',1,2147483647) AND f->>'state'=ANY(ARRAY['visible','hidden','deleted','root_removed','control','allocated'])) IS NOT TRUE THEN RETURN false; END IF;
 IF f?'hash' AND NOT coalesce(jsonb_typeof(f->'hash')='string' AND (f->>'hash')~'^[a-f0-9]{64}$',false) OR f->>'state'='visible' AND NOT f?'hash' THEN RETURN false; END IF;
 IF f?'authorId' AND NOT (public.adxc_jstr(f->'authorId',128) AND public.adxc_u16len(f->>'authorId')>=1) THEN RETURN false; END IF;
 IF f?'publicId' AND NOT public.adxc_public_number(f->'publicId') OR f->>'entity'='forum_id' AND NOT (f->>'state'='allocated' AND f?'publicId') THEN RETURN false; END IF;
 IF f?'controls' THEN
  c:=f->'controls'; IF NOT public.adxc_keys(c,ARRAY['locked','board','pin','readOnly','removedRoot','featured']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['locked','readOnly','removedRoot'] LOOP IF c?k AND jsonb_typeof(c->k) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF; END LOOP;
  IF c?'board' AND NOT coalesce(public.adxc_jstr(c->'board',128) AND (c->>'board')~'^[a-zA-Z0-9_:.-]+$',false) OR c?'pin' AND NOT public.adxc_jint(c->'pin',0,3) THEN RETURN false; END IF;
  IF c?'featured' THEN IF jsonb_typeof(c->'featured') IS DISTINCT FROM 'array' THEN RETURN false; END IF; IF jsonb_array_length(c->'featured')>6 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'featured') i WHERE NOT public.adxc_public_number(i)) THEN RETURN false; END IF; END IF;
 END IF; RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.adxc_library_public_valid(f jsonb, number text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE p jsonb;
BEGIN
 IF (public.adxc_keys(f,ARRAY['version','entity','id','userId','revision','publicId','draft','publication','deleted','createdAt','updatedAt']) AND f->'version'='1'::jsonb AND f->>'entity'='list' AND public.adxc_uuid(f->'id') AND public.adxc_jstr(f->'userId',128) AND public.adxc_u16len(f->>'userId')>=1 AND public.adxc_jint(f->'revision',1,2147483647) AND public.adxc_public_number(f->'publicId') AND public.adxc_library_draft(f->'draft') AND f->'deleted'='false'::jsonb AND public.adxc_datetime(f->'createdAt') AND public.adxc_datetime(f->'updatedAt')) IS NOT TRUE THEN RETURN false; END IF;
 p:=f->'publication';
 IF (public.adxc_keys(p,ARRAY['name','description','chartIds','revision','publicId','publishedAt','ownerCutoff']) AND public.adxc_library_draft(p-ARRAY['revision','publicId','publishedAt','ownerCutoff']) AND p->>'publicId'=number AND p->'publicId'=f->'publicId' AND public.adxc_jint(p->'revision',1,(f->>'revision')::numeric) AND public.adxc_jint(p->'ownerCutoff',0,9007199254740991) AND public.adxc_datetime(p->'publishedAt')) IS NOT TRUE THEN RETURN false; END IF;
 RETURN jsonb_array_length(p->'chartIds')>0;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
-- Validate immutable artifacts once in the index, then compare the live version's MD5/summary separately.
CREATE INDEX derived_objects_public_chart_integrity_idx ON derived_objects(id) WHERE mime='application/vnd.astrodx.chart-preview' AND public.adxc_manifest_valid(properties->'chartPreview',size,properties->'chartPreview'->'summary'->>'maidataMd5Base64');
--> statement-breakpoint
CREATE FUNCTION public.adxc_topic_hash(title text, body text, chart_ids jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT encode(sha256(convert_to(public.adxc_canonical_jsonb(jsonb_build_object('title',title,'body',body,'chartIds',chart_ids)),'UTF8')),'hex') $$;
--> statement-breakpoint
CREATE INDEX discussion_topics_public_integrity_idx ON discussion_topics(id) WHERE content_hash=public.adxc_topic_hash(title,body,linked_chart_ids);
--> statement-breakpoint
CREATE INDEX chart_lists_public_integrity_idx ON chart_lists(owner_id,id) WHERE public.adxc_library_public_valid(fact,public_id::text);

--> statement-breakpoint
CREATE INDEX community_content_states_public_integrity_idx ON community_content_states(key) WHERE public.adxc_community_fact_valid(fact);
