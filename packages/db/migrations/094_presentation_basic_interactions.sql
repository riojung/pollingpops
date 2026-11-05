-- Opt-in document 11 / scene 5. No existing JSON, hashes, references or defaults are rewritten.
-- Panels are public content. Only their open state is local to a viewer; no response meaning changes.
CREATE FUNCTION openround_presentation_plain_text_valid(value jsonb, maximum integer, required boolean DEFAULT false, identifier boolean DEFAULT false)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value) = 'string'
   AND length(value#>>'{}') <= maximum
   AND (NOT required OR length(btrim(value#>>'{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0)
   AND NOT EXISTS(SELECT 1 FROM regexp_split_to_table(value#>>'{}','') ch
     WHERE ch<>'' AND (ascii(ch)=127 OR (ascii(ch)<32 AND (identifier OR ascii(ch) NOT IN(9,10,13)))))
$$;

-- Mirror the external-link policy: explicit HTTP(S), no credentials, controls or whitespace.
-- Validate bracketed IPv6 and bounded ports separately so malformed authorities fail closed.
CREATE FUNCTION openround_presentation_external_link_valid(value text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE authority text; host text; port text; host_part text; host_bytes bytea:=''::bytea;
BEGIN
 IF value IS NULL OR length(value)>2048 OR value !~* '^https?://' OR value ~ '[[:space:][:cntrl:]\\]'
   OR value ~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' THEN RETURN false; END IF;
 -- WHATWG HTTP(S) parsing ignores extra leading slashes and empty user-info markers.
 -- Normalize only this validation scratch value; the stored URL and historical hashes stay exact.
 authority := split_part(split_part(split_part(regexp_replace(value,'^https?:/+','','i'),'/',1),'?',1),'#',1);
 authority := regexp_replace(authority,'^:?@','');
 IF EXISTS(SELECT 1 FROM regexp_split_to_table(value,'') ch WHERE ascii(ch) BETWEEN 127 AND 159) THEN RETURN false; END IF;
 IF authority='' OR authority ~ '[@<>^|]' THEN RETURN false; END IF;
 IF left(authority,1)='[' THEN
   IF authority !~ '^\[[0-9a-fA-F:.]+\](:[0-9]*)?$' THEN RETURN false; END IF;
   host:=split_part(substr(authority,2),']',1);
   IF family(host::inet)<>6 THEN RETURN false; END IF;
   port:=substring(authority FROM '\]:([0-9]*)$');
 ELSE
   IF authority ~ '[\[\]]' OR length(authority)-length(replace(authority,':',''))>1 THEN RETURN false; END IF;
   host:=split_part(authority,':',1);
   IF host='' THEN RETURN false; END IF;
   IF authority LIKE '%:%' THEN port:=split_part(authority,':',2); END IF;
   -- Decode domain bytes once, not path/query escapes or already-decoded percent text.
   -- https://url.spec.whatwg.org/#host-parsing
   IF strpos(host,'%')>0 THEN
     IF strpos(regexp_replace(host,'%[0-9A-Fa-f]{2}','','g'),'%')>0 THEN RETURN false; END IF;
     FOR host_part IN SELECT parts[1] FROM regexp_matches(host,'(%[0-9A-Fa-f]{2}|[^%]+)','g')
       WITH ORDINALITY AS pieces(parts,ord) ORDER BY pieces.ord LOOP
       host_bytes:=host_bytes || CASE WHEN left(host_part,1)='%'
         THEN decode(substr(host_part,2),'hex') ELSE convert_to(host_part,'UTF8') END;
     END LOOP;
     host:=convert_from(host_bytes,'UTF8');
   END IF;
   -- Validate compatibility-mapped delimiters and all-ignored hosts without changing stored URLs.
   host:=translate(normalize(host,NFKC),U&'\00AD\200B\FEFF','');
   IF host='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(host,'') ch
     WHERE ch<>'' AND (ascii(ch)<=32 OR ascii(ch) BETWEEN 127 AND 159
       OR ch=ANY(ARRAY['#','%','/',':','<','>','?','@','[',chr(92),']','^','|']))) THEN RETURN false; END IF;
 END IF;
 IF port IS NOT NULL AND port<>'' AND (port !~ '^[0-9]+$' OR port::numeric>65535) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
  OR character_not_in_repertoire OR untranslatable_character THEN RETURN false;
END $$;

-- Count compact JSON bytes, excluding jsonb's formatting spaces without touching text content.
CREATE FUNCTION openround_presentation_json_bytes(input_json jsonb)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE total bigint; item record;
BEGIN
 IF jsonb_typeof(input_json)='object' THEN
   total:=2;
   FOR item IN SELECT key, obj.value FROM jsonb_each(input_json) obj LOOP
     total:=total+octet_length(to_jsonb(item.key)::text)+1+openround_presentation_json_bytes(item.value)+1;
   END LOOP;
   RETURN total-CASE WHEN input_json='{}'::jsonb THEN 0 ELSE 1 END;
 ELSIF jsonb_typeof(input_json)='array' THEN
   SELECT 2+COALESCE(sum(openround_presentation_json_bytes(element)+1),0)-CASE WHEN jsonb_array_length(input_json)=0 THEN 0 ELSE 1 END
     INTO total FROM jsonb_array_elements(input_json) element;
   RETURN total;
 END IF;
 RETURN octet_length(input_json::text);
END $$;

CREATE FUNCTION openround_presentation_interaction_rich_text_valid(rich_json jsonb, fallback text, title boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE paragraph jsonb; run jsonb; plain text:=''; line text; run_count integer:=0;
BEGIN
 IF jsonb_typeof(rich_json) IS DISTINCT FROM 'object' OR (rich_json-ARRAY['paragraphs'])<>'{}'::jsonb
   OR jsonb_typeof(rich_json->'paragraphs') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(rich_json->'paragraphs') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
 FOR paragraph IN SELECT item FROM jsonb_array_elements(rich_json->'paragraphs') item LOOP
   IF jsonb_typeof(paragraph) IS DISTINCT FROM 'object' OR (paragraph-ARRAY['kind','runs'])<>'{}'::jsonb
     OR COALESCE(paragraph->>'kind','') NOT IN('paragraph','bullet','numbered')
     OR (title AND paragraph->>'kind'<>'paragraph') OR jsonb_typeof(paragraph->'runs') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF jsonb_array_length(paragraph->'runs') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
   line:='';
   FOR run IN SELECT item FROM jsonb_array_elements(paragraph->'runs') item LOOP
     run_count:=run_count+1;
     IF run_count>500 OR jsonb_typeof(run) IS DISTINCT FROM 'object' OR (run-ARRAY['text','bold','italic','href'])<>'{}'::jsonb
       OR NOT COALESCE(openround_presentation_plain_text_valid(run->'text',4000),false)
       OR run->>'text' ~ E'[\n\r]' OR (run ? 'bold' AND run->'bold'<>'true'::jsonb) OR (run ? 'italic' AND run->'italic'<>'true'::jsonb)
       OR (run ? 'href' AND (jsonb_typeof(run->'href') IS DISTINCT FROM 'string' OR NOT openround_presentation_external_link_valid(run->>'href'))) THEN RETURN false; END IF;
     line:=line||(run->>'text');
   END LOOP;
   plain:=plain||line||E'\n';
 END LOOP;
 RETURN left(plain,length(plain)-1)=fallback AND visual_import_utf16_length(fallback)<=4000;
END $$;

CREATE FUNCTION openround_presentation_interaction_scene_valid(scene jsonb, published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; other jsonb; member jsonb; group_item jsonb; frame jsonb; kind text; allowed text[];
 total numeric; series_count integer;
 ids text[]:='{}'; group_ids text[]:='{}'; grouped text[]:='{}'; title_count integer:=0;
 x double precision; y double precision; width double precision; height double precision; angle double precision;
 painted_width double precision; painted_height double precision;
BEGIN
 IF jsonb_typeof(scene) IS DISTINCT FROM 'object' OR scene->'schemaVersion' IS DISTINCT FROM '5'::jsonb
   OR scene->>'aspectRatio' IS DISTINCT FROM '16:9' OR (scene-ARRAY['schemaVersion','aspectRatio','design','groups','nodes','readingOrder'])<>'{}'::jsonb
   OR jsonb_typeof(scene->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(scene->'readingOrder') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(scene->'nodes') NOT BETWEEN 1 AND 50 OR jsonb_array_length(scene->'readingOrder')<>jsonb_array_length(scene->'nodes')
   OR openround_presentation_json_bytes(scene)>131072 THEN RETURN false; END IF;
 IF scene ? 'design' AND (jsonb_typeof(scene->'design') IS DISTINCT FROM 'object'
   OR ((scene->'design')-ARRAY['theme','font','spacing'])<>'{}'::jsonb
   OR COALESCE(scene->'design'->>'theme','') NOT IN('paper','midnight','ocean','sunset')
   OR COALESCE(scene->'design'->>'font','') NOT IN('sans','serif','mono')
   OR COALESCE(scene->'design'->>'spacing','') NOT IN('relaxed','compact')) THEN RETURN false; END IF;
 FOR node IN SELECT value FROM jsonb_array_elements(scene->'nodes') LOOP
   IF jsonb_typeof(node) IS DISTINCT FROM 'object' OR NOT COALESCE(openround_presentation_plain_text_valid(node->'id',200,true,true),false)
     OR node->>'id'=ANY(ids) THEN RETURN false; END IF;
   ids:=array_append(ids,node->>'id'); kind:=node->>'type';
   allowed:=CASE kind
     WHEN 'reveal' THEN ARRAY['id','type','frame','rotation','scope','label','body']
     WHEN 'link' THEN ARRAY['id','type','frame','rotation','label','href']
     WHEN 'text' THEN ARRAY['id','type','frame','rotation','role','text','richText']
     WHEN 'image' THEN ARRAY['id','type','frame','rotation','mediaId','altText','fit','focalPoint']
     WHEN 'shape' THEN ARRAY['id','type','frame','rotation','shape','color','label']
     WHEN 'table' THEN ARRAY['id','type','frame','rotation','caption','headers','rows']
     WHEN 'chart' THEN ARRAY['id','type','frame','rotation','chartType','title','summary','categories','series']
     WHEN 'connector' THEN ARRAY['id','type','from','to','label','color'] ELSE NULL END;
   IF allowed IS NULL OR (node-allowed)<>'{}'::jsonb THEN RETURN false; END IF;
   IF kind<>'connector' THEN
     frame:=node->'frame';
     IF jsonb_typeof(frame) IS DISTINCT FROM 'object' OR (frame-ARRAY['x','y','width','height'])<>'{}'::jsonb
       OR jsonb_typeof(frame->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(frame->'y') IS DISTINCT FROM 'number'
       OR jsonb_typeof(frame->'width') IS DISTINCT FROM 'number' OR jsonb_typeof(frame->'height') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
     IF (frame->>'x')::numeric NOT BETWEEN 0 AND 100 OR (frame->>'y')::numeric NOT BETWEEN 0 AND 100
       OR (frame->>'width')::numeric NOT BETWEEN 1 AND 100 OR (frame->>'height')::numeric NOT BETWEEN 1 AND 100
       OR (frame->>'x')::numeric+(frame->>'width')::numeric>100 OR (frame->>'y')::numeric+(frame->>'height')::numeric>100 THEN RETURN false; END IF;
     IF node ? 'rotation' THEN
       IF jsonb_typeof(node->'rotation') IS DISTINCT FROM 'number' OR (node->>'rotation')::numeric NOT BETWEEN -180 AND 180 THEN RETURN false; END IF;
       x:=(frame->>'x')::double precision; y:=(frame->>'y')::double precision;
       width:=(frame->>'width')::double precision; height:=(frame->>'height')::double precision;
       angle:=(node->>'rotation')::double precision*pi()/180;
       painted_width:=abs(width*cos(angle))+abs(height*9*sin(angle)/16);
       painted_height:=abs(height*cos(angle))+abs(width*16*sin(angle)/9);
       IF x+(width-painted_width)/2 < -1e-8 OR y+(height-painted_height)/2 < -1e-8
         OR x+(width+painted_width)/2>100+1e-8 OR y+(height+painted_height)/2>100+1e-8 THEN RETURN false; END IF;
     END IF;
   END IF;
   IF kind IN('reveal','link') THEN
     IF NOT COALESCE(openround_presentation_plain_text_valid(node->'label',120,published),false) THEN RETURN false; END IF;
     IF kind='reveal' THEN
       IF node->>'scope' IS DISTINCT FROM 'local' OR NOT COALESCE(openround_presentation_plain_text_valid(node->'body',4000,published),false) THEN RETURN false; END IF;
     ELSE
       IF jsonb_typeof(node->'href') IS DISTINCT FROM 'string' OR NOT ((NOT published AND node->>'href'='') OR openround_presentation_external_link_valid(node->>'href')) THEN RETURN false; END IF;
     END IF;
   ELSIF kind='text' THEN
     IF COALESCE(node->>'role','') NOT IN('title','body') OR NOT COALESCE(openround_presentation_plain_text_valid(node->'text',CASE WHEN node->>'role'='title' THEN 160 ELSE 4000 END),false) THEN RETURN false; END IF;
     IF node->>'role'='title' THEN
       title_count:=title_count+1;
       IF visual_import_utf16_length(node->>'text')>160 THEN RETURN false; END IF;
     END IF;
     IF node ? 'richText' AND NOT openround_presentation_interaction_rich_text_valid(node->'richText',node->>'text',node->>'role'='title') THEN RETURN false; END IF;
   ELSIF kind='image' THEN
     IF NOT openround_presentation_uuid_equal(node->>'mediaId',node->>'mediaId')
       OR NOT(node ? 'altText') OR NOT(node->'altText'='null'::jsonb OR COALESCE(openround_presentation_plain_text_valid(node->'altText',300,published),false))
       OR (published AND node->'altText'='null'::jsonb) THEN RETURN false; END IF;
     IF node ? 'fit' AND COALESCE(node->>'fit','') NOT IN('contain','cover') THEN RETURN false; END IF;
     IF node ? 'focalPoint' THEN
       other:=node->'focalPoint';
       IF node->>'fit' IS DISTINCT FROM 'cover' OR jsonb_typeof(other) IS DISTINCT FROM 'object' OR (other-ARRAY['x','y'])<>'{}'::jsonb
         OR jsonb_typeof(other->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(other->'y') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
       IF (other->>'x')::numeric NOT BETWEEN 0 AND 100 OR (other->>'y')::numeric NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
     END IF;
   ELSIF kind='table' THEN
     IF NOT COALESCE(openround_presentation_plain_text_valid(node->'caption',160,published),false)
       OR jsonb_typeof(node->'headers') IS DISTINCT FROM 'array' OR jsonb_typeof(node->'rows') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
     IF jsonb_array_length(node->'headers') NOT BETWEEN 1 AND 6 OR jsonb_array_length(node->'rows') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
     FOR other IN SELECT value FROM jsonb_array_elements(node->'headers') LOOP
       IF NOT COALESCE(openround_presentation_plain_text_valid(other,120,published),false) THEN RETURN false; END IF;
     END LOOP;
     FOR other IN SELECT value FROM jsonb_array_elements(node->'rows') LOOP
       IF jsonb_typeof(other) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
       IF jsonb_array_length(other)<>jsonb_array_length(node->'headers') THEN RETURN false; END IF;
       FOR member IN SELECT value FROM jsonb_array_elements(other) LOOP
         IF NOT COALESCE(openround_presentation_plain_text_valid(member,300),false) THEN RETURN false; END IF;
       END LOOP;
     END LOOP;
   ELSIF kind='chart' THEN
     IF COALESCE(node->>'chartType','') NOT IN('bar','line','pie')
       OR NOT COALESCE(openround_presentation_plain_text_valid(node->'title',160,published),false)
       OR NOT COALESCE(openround_presentation_plain_text_valid(node->'summary',800,published),false)
       OR jsonb_typeof(node->'categories') IS DISTINCT FROM 'array' OR jsonb_typeof(node->'series') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
     series_count:=jsonb_array_length(node->'series');
     IF jsonb_array_length(node->'categories') NOT BETWEEN 1 AND 20 OR series_count NOT BETWEEN 1 AND 4
       OR (node->>'chartType'='pie' AND series_count<>1) THEN RETURN false; END IF;
     FOR other IN SELECT value FROM jsonb_array_elements(node->'categories') LOOP
       IF NOT COALESCE(openround_presentation_plain_text_valid(other,80,published),false) THEN RETURN false; END IF;
     END LOOP;
     FOR other IN SELECT value FROM jsonb_array_elements(node->'series') LOOP
       IF jsonb_typeof(other) IS DISTINCT FROM 'object' OR (other-ARRAY['name','values'])<>'{}'::jsonb
         OR NOT COALESCE(openround_presentation_plain_text_valid(other->'name',80,published),false)
         OR jsonb_typeof(other->'values') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
       IF jsonb_array_length(other->'values')<>jsonb_array_length(node->'categories') THEN RETURN false; END IF;
       total:=0;
       FOR member IN SELECT value FROM jsonb_array_elements(other->'values') LOOP
         IF jsonb_typeof(member) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
         IF (member#>>'{}')::numeric NOT BETWEEN -1e12 AND 1e12 OR (node->>'chartType'='pie' AND (member#>>'{}')::numeric<0) THEN RETURN false; END IF;
         total:=total+(member#>>'{}')::numeric;
       END LOOP;
       IF node->>'chartType'='pie' AND total<=0 THEN RETURN false; END IF;
     END LOOP;
   ELSIF kind IN('shape','connector') THEN
     IF NOT COALESCE(openround_presentation_plain_text_valid(node->'label',200,published AND kind='shape'),false)
       OR COALESCE(node->>'color','') NOT IN('yellow','blue','green','pink','purple','white','orange','red','teal','lime','gray','black','amber','lavender','mint','sky') THEN RETURN false; END IF;
     IF kind='shape' AND COALESCE(node->>'shape','') NOT IN('rectangle','rounded_rectangle','triangle','star','pentagon','hexagon','octagon','cylinder','speech_bubble','cloud','cross','chevron','document','trapezoid','arrow_right','arrow_left','arrow_double','ellipse','diamond','parallelogram') THEN RETURN false; END IF;
   END IF;
 END LOOP;
 IF published AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scene->'nodes') content_node
   WHERE (content_node->>'type'='image') OR (content_node->>'type'='text' AND openround_presentation_plain_text_valid(content_node->'text',4000,true))
     OR (content_node->>'type' IN('shape','reveal','link') AND openround_presentation_plain_text_valid(content_node->'label',200,true))
     OR (content_node->>'type'='table' AND openround_presentation_plain_text_valid(content_node->'caption',160,true))
     OR (content_node->>'type'='chart' AND openround_presentation_plain_text_valid(content_node->'title',160,true))) THEN RETURN false; END IF;
 IF title_count<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(scene->'readingOrder') item
   WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR NOT(item#>>'{}'=ANY(ids)))
   OR (SELECT count(DISTINCT value#>>'{}') FROM jsonb_array_elements(scene->'readingOrder'))<>cardinality(ids) THEN RETURN false; END IF;
 FOR node IN SELECT value FROM jsonb_array_elements(scene->'nodes') WHERE value->>'type'='connector' LOOP
   FOREACH kind IN ARRAY ARRAY['from','to'] LOOP
     other:=node->kind;
     IF jsonb_typeof(other) IS DISTINCT FROM 'object' OR (other-ARRAY['nodeId','anchor'])<>'{}'::jsonb
       OR COALESCE(other->>'anchor','') NOT IN('center','top','right','bottom','left')
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scene->'nodes') target WHERE target->>'id'=other->>'nodeId' AND target->>'type'<>'connector') THEN RETURN false; END IF;
   END LOOP;
   IF node->'from'->>'nodeId'=node->'to'->>'nodeId' THEN RETURN false; END IF;
 END LOOP;
 IF scene ? 'groups' THEN
   IF jsonb_typeof(scene->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(scene->'groups')>25 THEN RETURN false; END IF;
   FOR group_item IN SELECT value FROM jsonb_array_elements(scene->'groups') LOOP
     IF jsonb_typeof(group_item) IS DISTINCT FROM 'object' OR (group_item-ARRAY['id','nodeIds'])<>'{}'::jsonb
       OR NOT COALESCE(openround_presentation_plain_text_valid(group_item->'id',200,true,true),false)
       OR group_item->>'id'=ANY(ids||group_ids) OR jsonb_typeof(group_item->'nodeIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
     group_ids:=array_append(group_ids,group_item->>'id');
     IF jsonb_array_length(group_item->'nodeIds') NOT BETWEEN 2 AND 50 THEN RETURN false; END IF;
     FOR member IN SELECT value FROM jsonb_array_elements(group_item->'nodeIds') LOOP
       IF jsonb_typeof(member) IS DISTINCT FROM 'string' OR member#>>'{}'=ANY(grouped)
         OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scene->'nodes') target WHERE target->>'id'=member#>>'{}' AND target->>'type'<>'connector') THEN RETURN false; END IF;
       grouped:=array_append(grouped,member#>>'{}');
     END LOOP;
   END LOOP;
 END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE FUNCTION openround_presentation_interactions_valid(document jsonb, stored_version integer, published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE block jsonb; scene jsonb; node jsonb; interactive boolean:=false;
BEGIN
 IF jsonb_typeof(document->'blocks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR block IN SELECT value FROM jsonb_array_elements(document->'blocks') LOOP
   IF published AND document->'schemaVersion'='11'::jsonb AND block->'hidden'='true'::jsonb THEN RETURN false; END IF;
   IF block->>'kind' IS DISTINCT FROM 'content' OR NOT(block ? 'scene') THEN CONTINUE; END IF;
   scene:=block->'scene';
   -- Legacy native scenes retain their established validation/read path. New native node types
   -- cannot be disguised inside an older scene/document or mismatching stored version column.
   IF jsonb_typeof(scene->'nodes')='array' THEN
     FOR node IN SELECT value FROM jsonb_array_elements(scene->'nodes') LOOP
       IF node->>'type' IN('reveal','link') THEN
         IF scene->'schemaVersion' IS DISTINCT FROM '5'::jsonb THEN RETURN false; END IF;
       END IF;
     END LOOP;
   END IF;
   IF scene->'schemaVersion'='5'::jsonb THEN
     interactive:=true;
     IF document->'schemaVersion' IS DISTINCT FROM '11'::jsonb OR stored_version IS DISTINCT FROM 11
       OR NOT openround_presentation_interaction_scene_valid(scene,published) THEN RETURN false; END IF;
   END IF;
 END LOOP;
 IF interactive AND (jsonb_array_length(document->'blocks')>200 OR openround_presentation_json_bytes(document)>3145728) THEN RETURN false; END IF;
 RETURN true;
END $$;

ALTER TABLE presentations ADD CONSTRAINT presentations_interactions_check
 CHECK(openround_presentation_interactions_valid(draft,draft_schema_version,false)) NOT VALID;
ALTER TABLE presentation_draft_history ADD CONSTRAINT presentation_history_interactions_check
 CHECK(openround_presentation_interactions_valid(draft,draft_schema_version,false)) NOT VALID;
ALTER TABLE presentation_versions ADD CONSTRAINT presentation_versions_interactions_check
 CHECK(openround_presentation_interactions_valid(content,content_schema_version,true)) NOT VALID;
CREATE FUNCTION enforce_presentation_interaction_session_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT openround_presentation_interactions_valid(NEW.content_snapshot,11,true) THEN
   RAISE EXCEPTION 'Invalid Presentation local interaction content' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_interaction_session_content BEFORE INSERT OR UPDATE OF content_snapshot ON presentation_live_sessions
 FOR EACH ROW EXECUTE FUNCTION enforce_presentation_interaction_session_content();

-- Extend the document gate only; response encoding, scoring and receipt invariants are unchanged.
CREATE OR REPLACE FUNCTION openround_presentation_opinion_formats_valid(document jsonb, stored_version integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  block jsonb;
  question jsonb;
  document_version integer;
  selection_limit integer;
  text_count integer := 0;
BEGIN
  IF jsonb_typeof(document) IS DISTINCT FROM 'object'
    OR jsonb_typeof(document->'blocks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF document ? 'schemaVersion' AND jsonb_typeof(document->'schemaVersion') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  IF COALESCE(document->>'schemaVersion', '1') !~ '^[0-9]{1,6}$' THEN RETURN false; END IF;
  document_version := COALESCE(document->>'schemaVersion', '1')::integer;
  FOR block IN SELECT value FROM jsonb_array_elements(document->'blocks') LOOP
    IF block->>'kind' IS DISTINCT FROM 'question' THEN CONTINUE; END IF;
    question := block->'question';
    IF question->>'type' IS NOT NULL AND question->>'type' NOT IN
      ('single_select', 'true_false', 'multi_select', 'poll', 'numeric', 'rating', 'ranking', 'open_text', 'word_cloud') THEN RETURN false; END IF;
    IF question->>'type' IN ('open_text','word_cloud') THEN
      text_count := text_count + 1;
      IF text_count > 10 OR document_version NOT IN (10,11) OR stored_version IS DISTINCT FROM document_version
        OR COALESCE(question->>'purpose','opinion') <> 'opinion'
        OR COALESCE(question->>'confidence','off') <> 'off'
        OR question->'basePoints' IS DISTINCT FROM '0'::jsonb
        OR COALESCE(question->>'delivery','main') <> 'main'
        OR question->>'linkedRecheckQuestionId' IS NOT NULL
        OR question ?| ARRAY['choices','maxSelections','rankCount','correctValue','tolerance','unit','min','max','minLabel','maxLabel']
        OR NOT openround_presentation_uuid_equal(block->>'id',block->>'id')
        OR NOT openround_presentation_uuid_equal(question->>'id',question->>'id') THEN RETURN false; END IF;
    END IF;
    selection_limit := 1;
    IF question->>'type' = 'poll' AND question ? 'maxSelections' THEN
      IF jsonb_typeof(question->'maxSelections') IS DISTINCT FROM 'number'
        OR question->>'maxSelections' !~ '^[1-6]$' THEN RETURN false; END IF;
      selection_limit := (question->>'maxSelections')::integer;
    END IF;
    IF question->>'type' = 'ranking' OR (question->>'type' = 'poll' AND selection_limit > 1) THEN
      IF document_version NOT IN (9,10,11) OR stored_version IS DISTINCT FROM document_version
        OR COALESCE(question->>'purpose', 'opinion') <> 'opinion'
        OR COALESCE(question->>'confidence', 'off') <> 'off'
        OR question->'basePoints' IS DISTINCT FROM '0'::jsonb
        OR COALESCE(question->>'delivery', 'main') <> 'main'
        OR question->>'linkedRecheckQuestionId' IS NOT NULL
        OR NOT openround_presentation_uuid_equal(block->>'id', block->>'id')
        OR NOT openround_presentation_uuid_equal(question->>'id', question->>'id')
        OR jsonb_typeof(question->'choices') IS DISTINCT FROM 'array'
        THEN RETURN false; END IF;
      IF jsonb_array_length(question->'choices') NOT BETWEEN 2 AND 6
        OR selection_limit > jsonb_array_length(question->'choices')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(question->'choices') choice
          WHERE choice->'isCorrect' IS DISTINCT FROM 'false'::jsonb
            OR NOT openround_presentation_uuid_equal(choice->>'id', choice->>'id'))
        OR (SELECT count(*) <> count(DISTINCT lower(choice->>'id'))
          FROM jsonb_array_elements(question->'choices') choice) THEN RETURN false; END IF;
      IF question->>'type' = 'ranking' AND question ? 'rankCount' THEN
        IF jsonb_typeof(question->'rankCount') IS DISTINCT FROM 'number'
          OR question->>'rankCount' !~ '^[1-6]$' THEN RETURN false; END IF;
        IF (question->>'rankCount')::integer > jsonb_array_length(question->'choices') THEN RETURN false; END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- Extend the document gate only; response encoding, scoring and receipt invariants are unchanged.
CREATE OR REPLACE FUNCTION enforce_presentation_opinion_response()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document jsonb;
  current_block jsonb;
  question jsonb;
  selected jsonb;
  expected_count integer;
  selected_count integer;
  opinion_format boolean;
BEGIN
  SELECT content_snapshot, content_snapshot->'blocks'->current_block_index
    INTO document, current_block FROM presentation_live_sessions
    WHERE workspace_id = NEW.workspace_id AND id = NEW.session_id;
  IF current_block->>'kind' = 'question'
    AND openround_presentation_uuid_equal(current_block->>'id', NEW.block_id::text) THEN
    question := current_block->'question';
  ELSE
    -- Historical compatibility writes use the frozen matching block; normal live acceptance
    -- uses the current block above without scanning the full presentation for every answer.
    SELECT block->'question' INTO question
      FROM jsonb_array_elements(COALESCE(document->'blocks', '[]'::jsonb)) block
      WHERE block->>'kind' = 'question'
        AND openround_presentation_uuid_equal(block->>'id', NEW.block_id::text);
  END IF;
  opinion_format := question->>'type' = 'ranking' OR
    (question->>'type' = 'poll' AND COALESCE((question->>'maxSelections')::integer, 1) > 1);
  IF NOT COALESCE(opinion_format, false) AND NOT (NEW.response ? 'orderedChoiceIds') THEN RETURN NEW; END IF;
  -- Classify by the frozen block first: a mismatched question UUID must not disguise an
  -- opinion response as a legacy compatibility write and bypass the v2 format checks.
  IF NOT COALESCE(opinion_format, false) OR NEW.response_schema_version <> 2
    OR NOT openround_presentation_uuid_equal(question->>'id', NEW.question_id::text)
    OR COALESCE(document->>'schemaVersion','') NOT IN ('9','10','11')
    OR NEW.correct IS NOT NULL OR NEW.score <> 0
    OR NEW.response->>'confidence' IS NOT NULL
    OR NEW.response ?| ARRAY['numericValue', 'ratingValue'] THEN
    RAISE EXCEPTION 'Presentation opinion responses require the frozen v9 unscored response v2 format' USING ERRCODE = '23514';
  END IF;
  IF question->>'type' = 'ranking' THEN
    IF NEW.response ? 'choiceIds' THEN
      RAISE EXCEPTION 'Presentation rankings require orderedChoiceIds' USING ERRCODE = '23514';
    END IF;
    selected := NEW.response->'orderedChoiceIds';
    expected_count := COALESCE((question->>'rankCount')::integer, jsonb_array_length(question->'choices'));
  ELSE
    IF NEW.response ? 'orderedChoiceIds' THEN
      RAISE EXCEPTION 'Presentation polls require unordered choiceIds' USING ERRCODE = '23514';
    END IF;
    selected := NEW.response->'choiceIds';
    expected_count := (question->>'maxSelections')::integer;
  END IF;
  IF jsonb_typeof(selected) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Presentation opinions require selected choice IDs' USING ERRCODE = '23514';
  END IF;
  selected_count := jsonb_array_length(selected);
  IF selected_count < 1 OR selected_count > expected_count
    OR (question->>'type' = 'ranking' AND selected_count <> expected_count)
    OR selected_count <> (SELECT count(DISTINCT lower(value)) FROM jsonb_array_elements_text(selected))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(selected) selection
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question->'choices') choice
        WHERE openround_presentation_uuid_equal(choice->>'id', selection.value))) THEN
    RAISE EXCEPTION 'Presentation opinion choices must be unique, belong to the question and match its limits' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Extend the document gate only; response encoding, scoring and receipt invariants are unchanged.
CREATE OR REPLACE FUNCTION enforce_presentation_text_response()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room record; frozen jsonb; text_question boolean;
BEGIN
 SELECT * INTO room FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id;
 SELECT block->'question' INTO frozen FROM jsonb_array_elements(COALESCE(room.content_snapshot->'blocks','[]'::jsonb)) block
  WHERE block->>'kind'='question' AND openround_presentation_uuid_equal(block->>'id',NEW.block_id::text);
 text_question := COALESCE(frozen->>'type' IN('open_text','word_cloud'),false);
 IF NOT text_question AND NEW.response_schema_version<>3 AND NEW.text_value IS NULL AND NEW.moderation_status IS NULL
   AND NEW.moderation_version IS NULL AND NEW.moderated_at IS NULL AND NOT(NEW.response ? 'textValue') THEN RETURN NEW; END IF;
 -- Ordinary concurrent answers retain their existing FOR SHARE path. Only actual text writes
 -- acquire the exclusive capacity/moderation fence, then refresh frozen classification.
 SELECT * INTO room FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
 SELECT block->'question' INTO frozen FROM jsonb_array_elements(COALESCE(room.content_snapshot->'blocks','[]'::jsonb)) block
  WHERE block->>'kind'='question' AND openround_presentation_uuid_equal(block->>'id',NEW.block_id::text);
 text_question := COALESCE(frozen->>'type' IN('open_text','word_cloud'),false);
 IF NOT text_question OR COALESCE(room.content_snapshot->>'schemaVersion','') NOT IN ('10','11') OR NEW.response_schema_version<>3
   OR NOT openround_presentation_uuid_equal(frozen->>'id',NEW.question_id::text)
   OR NEW.response IS DISTINCT FROM '{}'::jsonb OR NEW.correct IS NOT NULL OR NEW.score<>0
   OR NEW.idempotency_key IS NULL OR length(NEW.idempotency_key) NOT BETWEEN 1 AND 160
   OR NEW.request_hash IS NULL OR NEW.request_hash !~ '^[a-f0-9]{64}$'
   OR NEW.moderation_status IS NULL OR NEW.moderation_status NOT IN('pending','approved','removed')
   OR NEW.moderation_version IS NULL OR NEW.moderation_version<0
   OR (NEW.moderation_status='removed' AND NEW.text_value IS NOT NULL)
   OR (NEW.moderation_status<>'removed' AND NOT openround_presentation_text_value_valid(NEW.text_value,frozen->>'type')) THEN
  RAISE EXCEPTION 'Invalid private Presentation text response' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.moderation_status<>'pending' OR NEW.moderation_version<>0 OR NEW.moderated_at IS NOT NULL
    OR (SELECT count(*) FROM presentation_live_responses WHERE session_id=NEW.session_id AND response_schema_version=3)>=2500
    OR (SELECT count(*) FROM presentation_live_responses WHERE session_id=NEW.session_id AND block_id=NEW.block_id AND response_schema_version=3)>=250 THEN
   RAISE EXCEPTION 'Presentation text response initial state or capacity is invalid' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.participant_id IS DISTINCT FROM OLD.participant_id OR NEW.block_id IS DISTINCT FROM OLD.block_id OR NEW.question_id IS DISTINCT FROM OLD.question_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.response_ms IS DISTINCT FROM OLD.response_ms OR NEW.response_schema_version IS DISTINCT FROM OLD.response_schema_version THEN
   RAISE EXCEPTION 'Accepted text receipt identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
   IF room.status<>'active' OR room.live_expires_at<=clock_timestamp() OR OLD.moderation_status='removed'
     OR (OLD.moderation_status='approved' AND NEW.moderation_status<>'removed')
     OR NEW.moderation_version<>OLD.moderation_version+1 OR NEW.moderated_at IS NULL
     OR (NEW.moderation_status<>'removed' AND NEW.text_value IS DISTINCT FROM OLD.text_value) THEN
    RAISE EXCEPTION 'Invalid or closed Presentation text moderation transition' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.text_value IS DISTINCT FROM OLD.text_value OR NEW.moderation_version IS DISTINCT FROM OLD.moderation_version OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at THEN
   RAISE EXCEPTION 'Text body cannot be edited or restored' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
