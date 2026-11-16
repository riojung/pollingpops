-- Match the JavaScript PresentationSceneFrameSchema arithmetic at the slide edges.
-- A drag/resize can serialize x=0.30000000000000004, width=99.7: binary64 adds
-- them to 100, while exact PostgreSQL numeric addition incorrectly rejects the frame.
-- Keep every existing scalar range, node/target, size and publication guard intact.
-- This replaces validation only; stored drafts, frozen content and hashes stay unchanged.
CREATE OR REPLACE FUNCTION openround_presentation_interaction_scene_valid(scene jsonb, published boolean)
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
       OR (frame->>'x')::double precision+(frame->>'width')::double precision>100 OR (frame->>'y')::double precision+(frame->>'height')::double precision>100 THEN RETURN false; END IF;
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

-- Hotspot containment uses the same binary64 edge additions as its contract.
CREATE OR REPLACE FUNCTION openround_presentation_advanced_scene_valid(scene jsonb,published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; converted jsonb:='[]'; image jsonb; legacy jsonb;
BEGIN
 IF jsonb_typeof(scene) IS DISTINCT FROM 'object' OR scene->'schemaVersion' NOT IN ('6'::jsonb,'7'::jsonb,'8'::jsonb,'9'::jsonb) OR openround_presentation_json_bytes(scene)>131072 OR jsonb_typeof(scene->'nodes') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF NOT openround_presentation_styled_scene_fields_valid(scene) THEN RETURN false; END IF;
 IF NOT openround_presentation_motion_scene_design_valid(scene) THEN RETURN false; END IF;
 -- Decorative shapes never supply the meaningful audience content required to publish.
 IF published AND scene->'schemaVersion'='9'::jsonb AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(scene->'nodes') content_node
  WHERE content_node->>'type'='image'
   OR (content_node->>'type'='text' AND openround_presentation_plain_text_valid(content_node->'text',4000,true))
   OR (content_node->>'type'='shape' AND content_node->'decorative' IS DISTINCT FROM 'true'::jsonb AND openround_presentation_plain_text_valid(content_node->'label',200,true))
   OR (content_node->>'type' IN ('reveal','link','hotspot','dialog','navigation') AND openround_presentation_plain_text_valid(content_node->'label',200,true))
   OR (content_node->>'type'='table' AND openround_presentation_plain_text_valid(content_node->'caption',160,true))
   OR (content_node->>'type'='chart' AND openround_presentation_plain_text_valid(content_node->'title',160,true))
 ) THEN RETURN false; END IF;
 FOR node IN SELECT value FROM jsonb_array_elements(scene->'nodes') LOOP
  IF node->>'type'='shape' AND node->'decorative'='true'::jsonb THEN node:=node||jsonb_build_object('label','decorative shape'); END IF;
  node:=node-ARRAY['typography','appearance','decorative'];
  IF node ? 'lang' THEN
   IF scene->'schemaVersion' NOT IN ('7'::jsonb,'8'::jsonb,'9'::jsonb) OR node->>'type' IS DISTINCT FROM 'text'
     OR NOT COALESCE(openround_presentation_text_language_valid(node->'lang'),false) THEN RETURN false; END IF;
   node:=node-'lang';
  END IF;
  IF node->>'type' IN('hotspot','dialog') THEN
   IF (node-CASE WHEN node->>'type'='hotspot' THEN ARRAY['id','type','frame','rotation','imageNodeId','scope','label','detailTitle','body'] ELSE ARRAY['id','type','frame','rotation','scope','label','detailTitle','body'] END)<>'{}'::jsonb
    OR node->>'scope' IS DISTINCT FROM 'local' OR NOT COALESCE(openround_presentation_plain_text_valid(node->'detailTitle',160,published),false)
    OR visual_import_utf16_length(node->>'detailTitle')>160 THEN RETURN false; END IF;
   IF node->>'type'='hotspot' THEN
    IF NOT(node ? 'imageNodeId') OR (node->'imageNodeId'<>'null'::jsonb AND (jsonb_typeof(node->'imageNodeId') IS DISTINCT FROM 'string' OR NOT COALESCE(openround_presentation_plain_text_valid(node->'imageNodeId',200,true,true),false))) THEN RETURN false; END IF;
    IF published THEN
     SELECT n INTO image FROM jsonb_array_elements(scene->'nodes') n WHERE n->>'id'=node->>'imageNodeId' AND n->>'type'='image';
     IF image IS NULL OR COALESCE((image->>'rotation')::numeric,0)<>0 OR COALESCE((node->>'rotation')::numeric,0)<>0
      OR (node->'frame'->>'x')::numeric<(image->'frame'->>'x')::numeric OR (node->'frame'->>'y')::numeric<(image->'frame'->>'y')::numeric
      OR (node->'frame'->>'x')::double precision+(node->'frame'->>'width')::double precision>(image->'frame'->>'x')::double precision+(image->'frame'->>'width')::double precision
      OR (node->'frame'->>'y')::double precision+(node->'frame'->>'height')::double precision>(image->'frame'->>'y')::double precision+(image->'frame'->>'height')::double precision THEN RETURN false; END IF;
    END IF;
   END IF;
   node:=(node-ARRAY['imageNodeId','detailTitle'])||jsonb_build_object('type','reveal');
  ELSIF node->>'type'='navigation' THEN
   IF (node-ARRAY['id','type','frame','rotation','label','targetBlockId'])<>'{}'::jsonb OR NOT(node ? 'targetBlockId')
    OR (node->'targetBlockId'='null'::jsonb AND published) OR (node->'targetBlockId'<>'null'::jsonb AND (jsonb_typeof(node->'targetBlockId') IS DISTINCT FROM 'string' OR NOT COALESCE(openround_presentation_uuid_equal(node->>'targetBlockId',node->>'targetBlockId'),false))) THEN RETURN false; END IF;
   node:=(node-'targetBlockId')||jsonb_build_object('type','link','href','https://example.invalid');
  ELSIF node->>'type'='reveal' AND node->>'scope'='broadcast' THEN
   node:=node||jsonb_build_object('scope','local');
  END IF;
  converted:=converted||jsonb_build_array(node);
 END LOOP;
 -- Validation projection only: preserve persisted bytes and enforce the original full size above.
 legacy:=scene||jsonb_build_object('schemaVersion',5,'nodes',converted);
 IF scene->'schemaVersion' IN ('8'::jsonb,'9'::jsonb) AND scene ? 'design' THEN
  legacy:=jsonb_set(legacy,'{design}',(scene->'design')-ARRAY['motionBackground','palette']);
 END IF;
 RETURN openround_presentation_interaction_scene_valid(legacy,published);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
