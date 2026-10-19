ALTER TABLE charts ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=8);
--> statement-breakpoint
ALTER TABLE chart_publications ADD COLUMN aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array' AND jsonb_array_length(aliases)<=8);
--> statement-breakpoint
CREATE FUNCTION adxc_canonical_jsonb(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||adxc_canonical_jsonb(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(adxc_canonical_jsonb(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord);
 WHEN 'number' THEN result:=to_jsonb((v#>>'{}')::double precision)::text;
 ELSE result:=v::text;
 END CASE;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION adxc_text_key(v text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT translate(regexp_replace(btrim(normalize(v,NFKC)), '[[:space:]]+', ' ', 'g'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') $$;
--> statement-breakpoint
CREATE FUNCTION adxc_u16len(v text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT char_length(v)+char_length(regexp_replace(v,U&'[^\+010000-\+10FFFF]','','g')) $$;
--> statement-breakpoint
CREATE FUNCTION adxc_keys(v jsonb, allowed text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF; RETURN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE NOT k=ANY(allowed)); END $$;
--> statement-breakpoint
CREATE FUNCTION adxc_jstr(v jsonb, maxlen integer) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(jsonb_typeof(v)='string' AND adxc_u16len(v#>>'{}')<=maxlen,false) $$;
--> statement-breakpoint
CREATE FUNCTION adxc_jint(v jsonb, low numeric, high numeric) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE n numeric;
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RETURN false; END IF; n:=(v#>>'{}')::numeric; RETURN n=trunc(n) AND n>=low AND n<=high; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
--> statement-breakpoint
CREATE FUNCTION adxc_summary_valid(s jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE d jsonb; a jsonb; seen integer[]:='{}'; n integer;
BEGIN
 IF (adxc_keys(s,ARRAY['title','artist','maidataMd5Base64','difficulties','warnings','audio','hasCover']) AND adxc_jstr(s->'title',120) AND adxc_jstr(s->'artist',120) AND (s->>'maidataMd5Base64')~'^[A-Za-z0-9+/]{22}==$' AND jsonb_typeof(s->'hasCover')='boolean' AND jsonb_typeof(s->'difficulties')='array' AND jsonb_typeof(s->'warnings')='array') IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(s->'difficulties') NOT BETWEEN 1 AND 7 OR jsonb_array_length(s->'warnings')>64 THEN RETURN false; END IF;
 FOR d IN SELECT * FROM jsonb_array_elements(s->'difficulties') LOOP
  IF (adxc_keys(d,ARRAY['difficulty','level','designer','noteCount','durationMs','previewSupported']) AND adxc_jint(d->'difficulty',1,7) AND (d->'level'='null'::jsonb OR adxc_jstr(d->'level',120)) AND (NOT d?'designer' OR adxc_jstr(d->'designer',240)) AND (d->'noteCount'='null'::jsonb OR adxc_jint(d->'noteCount',0,100000)) AND (d->'durationMs'='null'::jsonb OR adxc_jint(d->'durationMs',0,3600000)) AND jsonb_typeof(d->'previewSupported')='boolean') IS NOT TRUE THEN RETURN false; END IF;
  n:=(d->>'difficulty')::integer; IF n=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,n);
  IF d->>'previewSupported'='true' AND (d->'noteCount'='null'::jsonb OR d->'durationMs'='null'::jsonb) THEN RETURN false; END IF;
 END LOOP;
 FOR d IN SELECT * FROM jsonb_array_elements(s->'warnings') LOOP
  IF (adxc_keys(d,ARRAY['code','difficulty','line']) AND jsonb_typeof(d->'code')='string' AND (d->>'code')~'^[A-Z][A-Z0-9_]{0,63}$' AND (NOT d?'difficulty' OR adxc_jint(d->'difficulty',1,7)) AND (NOT d?'line' OR adxc_jint(d->'line',1,1048576))) IS NOT TRUE THEN RETURN false; END IF;
 END LOOP;
 a:=s->'audio';
 IF (a='null'::jsonb OR (adxc_keys(a,ARRAY['mime','size']) AND a->>'mime'=ANY(ARRAY['audio/mpeg','audio/ogg','audio/wav']) AND adxc_jint(a->'size',1,33554432))) IS NOT TRUE THEN RETURN false; END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION adxc_manifest_valid(m jsonb, artifact_size bigint, md5 text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE a jsonb; s jsonb; role integer; previous integer:=-1; off bigint:=0; path text; has_audio boolean:=false; has_cover boolean:=false; bytes integer;
BEGIN
 IF (adxc_keys(m,ARRAY['format','assets','summary']) AND m->'format'='1'::jsonb AND jsonb_typeof(m->'assets')='array' AND adxc_summary_valid(m->'summary') AND m->'summary'->>'maidataMd5Base64'=md5) IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(m->'assets') NOT BETWEEN 1 AND 3 THEN RETURN false; END IF;
 s:=m->'summary';
 FOR a IN SELECT * FROM jsonb_array_elements(m->'assets') LOOP
  IF (adxc_keys(a,ARRAY['role','path','mime','size','sha256','offset']) AND jsonb_typeof(a->'role')='string' AND jsonb_typeof(a->'path')='string' AND jsonb_typeof(a->'mime')='string' AND adxc_jint(a->'size',1,33554432) AND adxc_jint(a->'offset',off,off) AND jsonb_typeof(a->'sha256')='string' AND (a->>'sha256')~'^[a-f0-9]{64}$') IS NOT TRUE THEN RETURN false; END IF;
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
 bytes:=octet_length(adxc_canonical_jsonb(m));
 RETURN coalesce(bytes<=32768 AND artifact_size BETWEEN 12 AND 50331648 AND artifact_size=12+bytes+off,false);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION adxc_library_public_valid(f jsonb, number text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE p jsonb; ids jsonb;
BEGIN
 p:=f->'publication'; ids:=p->'chartIds';
 IF (adxc_keys(p,ARRAY['name','description','chartIds','revision','publicId','publishedAt','ownerCutoff']) AND jsonb_typeof(p->'name')='string' AND char_length(p->>'name') BETWEEN 1 AND 60 AND jsonb_typeof(p->'description')='string' AND char_length(p->>'description')<=500 AND p->>'publicId'=number AND adxc_jint(p->'revision',1,2147483647) AND adxc_jint(p->'ownerCutoff',0,9007199254740991) AND jsonb_typeof(ids)='array' AND f->'deleted'='false'::jsonb AND p->>'publicId'=f->>'publicId') IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(ids) NOT BETWEEN 1 AND 200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(ids) i WHERE jsonb_typeof(i)<>'string' OR NOT (i#>>'{}')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') OR (SELECT count(DISTINCT i) FROM jsonb_array_elements(ids) i)<>jsonb_array_length(ids) THEN RETURN false; END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
