-- Opt-in document13/scene6. Existing documents, hashes, migrations and response attempts remain unchanged.
ALTER TABLE presentation_live_sessions ADD COLUMN interaction_state jsonb;
ALTER TABLE presentation_session_timeline ADD COLUMN interaction jsonb, ADD COLUMN branch jsonb;
ALTER TABLE presentation_session_timeline DROP CONSTRAINT presentation_session_timeline_event_type_check;
ALTER TABLE presentation_session_timeline ADD CONSTRAINT presentation_session_timeline_event_type_check CHECK(event_type IN('presentation.started','content.presented','question.launched','question.revealed','intervention.presented','presentation.finished','navigation.jumped','navigation.returned','navigation.revisited','navigation.branched','scene.reveal_changed'));
ALTER TABLE presentation_session_command_receipts DROP CONSTRAINT presentation_session_command_receipts_event_type_check;
ALTER TABLE presentation_session_command_receipts ADD CONSTRAINT presentation_session_command_receipts_event_type_check CHECK(event_type IN('presentation.started','content.presented','question.launched','question.revealed','intervention.presented','presentation.finished','navigation.jumped','navigation.returned','navigation.revisited','navigation.branched','scene.reveal_changed'));

CREATE OR REPLACE FUNCTION openround_presentation_interactions_valid(document jsonb, stored_version integer, published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE block jsonb; scene jsonb; node jsonb; interactive boolean:=false;
BEGIN
 IF jsonb_typeof(document->'blocks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR block IN SELECT value FROM jsonb_array_elements(document->'blocks') LOOP
   IF published AND document->'schemaVersion' IN ('11'::jsonb,'12'::jsonb,'13'::jsonb) AND block->'hidden'='true'::jsonb THEN RETURN false; END IF;
   IF block->>'kind' IS DISTINCT FROM 'content' OR NOT(block ? 'scene') THEN CONTINUE; END IF;
   scene:=block->'scene';
   -- Legacy native scenes retain their established validation/read path. New native node types
   -- cannot be disguised inside an older scene/document or mismatching stored version column.
   IF jsonb_typeof(scene->'nodes')='array' THEN
     FOR node IN SELECT value FROM jsonb_array_elements(scene->'nodes') LOOP
       IF node->>'type' IN('reveal','link') THEN
         IF scene->'schemaVersion' NOT IN ('5'::jsonb,'6'::jsonb) THEN RETURN false; END IF;
       END IF;
     END LOOP;
   END IF;
   IF scene->'schemaVersion'='5'::jsonb THEN
     interactive:=true;
     IF document->'schemaVersion' IS NULL OR document->'schemaVersion' NOT IN ('11'::jsonb,'12'::jsonb,'13'::jsonb) OR stored_version IS DISTINCT FROM (document->>'schemaVersion')::integer
       OR NOT openround_presentation_interaction_scene_valid(scene,published) THEN RETURN false; END IF;
   END IF;
 END LOOP;
 IF interactive AND (jsonb_array_length(document->'blocks')>200 OR openround_presentation_json_bytes(document)>3145728) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION enforce_presentation_interaction_session_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT openround_presentation_interactions_valid(NEW.content_snapshot,CASE WHEN NEW.content_snapshot->>'schemaVersion' ~ '^[0-9]{1,6}$' THEN (NEW.content_snapshot->>'schemaVersion')::integer ELSE 1 END,true) THEN
   RAISE EXCEPTION 'Invalid Presentation local interaction content' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

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
      IF text_count > 10 OR document_version NOT IN (10,11,12,13) OR stored_version IS DISTINCT FROM document_version
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
      IF document_version NOT IN (9,10,11,12,13) OR stored_version IS DISTINCT FROM document_version
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
    OR COALESCE(document->>'schemaVersion','') NOT IN ('9','10','11','12','13')
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
 IF NOT text_question OR COALESCE(room.content_snapshot->>'schemaVersion','') NOT IN ('10','11','12','13') OR NEW.response_schema_version<>3
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

CREATE OR REPLACE FUNCTION openround_presentation_sections_valid(document jsonb, stored_version integer, published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE section jsonb; member jsonb; ids text[]:='{}'; members text[]:='{}'; question_ids text[]:='{}'; choice_ids text[]:='{}'; block jsonb; choice jsonb; source_index integer; target_index integer;
BEGIN
 IF COALESCE(document->'schemaVersion','0'::jsonb) NOT IN ('12'::jsonb,'13'::jsonb) THEN RETURN NOT(document ? 'sections'); END IF;
 IF stored_version IS DISTINCT FROM (document->>'schemaVersion')::integer OR jsonb_typeof(document->'blocks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(document->'blocks')>200 OR openround_presentation_json_bytes(document)>3145728 THEN RETURN false; END IF;
 FOR block IN SELECT value FROM jsonb_array_elements(document->'blocks') LOOP
  IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR COALESCE(block->>'kind','') NOT IN('content','question') OR NOT COALESCE(openround_presentation_uuid_equal(block->>'id',block->>'id'),false) OR lower(block->>'id')=ANY(ids) THEN RETURN false; END IF;
  IF block->>'kind'='question' THEN
   IF jsonb_typeof(block->'question') IS DISTINCT FROM 'object' OR NOT COALESCE(openround_presentation_uuid_equal(block->'question'->>'id',block->'question'->>'id'),false) OR lower(block->'question'->>'id')=ANY(question_ids) THEN RETURN false; END IF;
   question_ids:=array_append(question_ids,lower(block->'question'->>'id'));
   IF block->'question' ? 'choices' THEN
    IF jsonb_typeof(block->'question'->'choices') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR choice IN SELECT value FROM jsonb_array_elements(block->'question'->'choices') LOOP
     IF NOT COALESCE(openround_presentation_uuid_equal(choice->>'id',choice->>'id'),false) OR lower(choice->>'id')=ANY(choice_ids) THEN RETURN false; END IF;
     choice_ids:=array_append(choice_ids,lower(choice->>'id'));
    END LOOP;
   END IF;
  END IF;
  ids:=array_append(ids,lower(block->>'id'));
  IF published AND block->'hidden'='true'::jsonb THEN RETURN false; END IF;
 END LOOP;
 IF published THEN
  FOR block,source_index IN SELECT b.value,(b.ordinality-1)::integer FROM jsonb_array_elements(document->'blocks') WITH ORDINALITY b WHERE b.value->>'kind'='question' LOOP
   IF block->'question'->>'linkedRecheckQuestionId' IS NOT NULL THEN
    SELECT (b.ordinality-1)::integer INTO target_index FROM jsonb_array_elements(document->'blocks') WITH ORDINALITY b WHERE b.value->>'kind'='question' AND b.value->'question'->>'delivery'='recheck' AND b.value->'question'->>'id'=block->'question'->>'linkedRecheckQuestionId';
    IF target_index IS NULL OR target_index<=source_index THEN RETURN false; END IF;
   END IF;
   IF block->'question'->>'delivery'='recheck' AND (SELECT count(*) FROM jsonb_array_elements(document->'blocks') source WHERE source->>'kind'='question' AND source->'question'->>'linkedRecheckQuestionId'=block->'question'->>'id')<>1 THEN RETURN false; END IF;
  END LOOP;
 END IF;
 IF NOT(document ? 'sections') THEN RETURN true; END IF;
 IF jsonb_typeof(document->'sections') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(document->'sections')>50 THEN RETURN false; END IF;
 ids:='{}';
 FOR section IN SELECT value FROM jsonb_array_elements(document->'sections') LOOP
  IF jsonb_typeof(section) IS DISTINCT FROM 'object' OR (section-ARRAY['id','title','blockIds'])<>'{}'::jsonb
   OR NOT COALESCE(openround_presentation_uuid_equal(section->>'id',section->>'id'),false) OR lower(section->>'id')=ANY(ids)
   OR NOT COALESCE(openround_presentation_plain_text_valid(section->'title',120,published,true),false)
   OR visual_import_utf16_length(section->>'title')>120 OR jsonb_typeof(section->'blockIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  ids:=array_append(ids,lower(section->>'id'));
  IF jsonb_array_length(section->'blockIds')>200 OR (published AND jsonb_array_length(section->'blockIds')=0) THEN RETURN false; END IF;
  FOR member IN SELECT value FROM jsonb_array_elements(section->'blockIds') LOOP
   IF jsonb_typeof(member) IS DISTINCT FROM 'string' OR NOT COALESCE(openround_presentation_uuid_equal(member#>>'{}',member#>>'{}'),false)
    OR lower(member#>>'{}')=ANY(members) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'blocks') b WHERE openround_presentation_uuid_equal(b->>'id',member#>>'{}')) THEN RETURN false; END IF;
   members:=array_append(members,lower(member#>>'{}'));
  END LOOP;
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION openround_presentation_navigation_state_valid(document jsonb, state jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE progress jsonb; frozen jsonb; entry jsonb; reference jsonb; seen text[]:='{}'; opened timestamptz; closes timestamptz;
BEGIN
 IF COALESCE(document->'schemaVersion','0'::jsonb) NOT IN ('12'::jsonb,'13'::jsonb) THEN RETURN state IS NULL; END IF;
 IF state IS NULL OR jsonb_typeof(state) IS DISTINCT FROM 'object' OR (state-ARRAY['returnBlockId','blocks'])<>'{}'::jsonb
  OR NOT(state ?& ARRAY['returnBlockId','blocks']) OR jsonb_typeof(state->'blocks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(state->'blocks')>200 THEN RETURN false; END IF;
 IF state->'returnBlockId'<>'null'::jsonb AND (jsonb_typeof(state->'returnBlockId') IS DISTINCT FROM 'string'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'blocks') b WHERE openround_presentation_uuid_equal(b->>'id',state->>'returnBlockId'))) THEN RETURN false; END IF;
 FOR progress IN SELECT value FROM jsonb_array_elements(state->'blocks') LOOP
  IF jsonb_typeof(progress) IS DISTINCT FROM 'object' OR (progress-ARRAY['blockId','phase','questionOpenedAt','questionClosesAt','recoveryPackIntervention'])<>'{}'::jsonb
   OR NOT(progress ?& ARRAY['blockId','phase','questionOpenedAt','questionClosesAt']) OR lower(progress->>'blockId')=ANY(seen)
   OR COALESCE(progress->>'phase','') NOT IN('content','question_open','question_reveal','intervention') THEN RETURN false; END IF;
  SELECT b INTO frozen FROM jsonb_array_elements(document->'blocks') b WHERE openround_presentation_uuid_equal(b->>'id',progress->>'blockId');
  IF frozen IS NULL OR (frozen->>'kind'='content') IS DISTINCT FROM (progress->>'phase'='content') THEN RETURN false; END IF;
  seen:=array_append(seen,lower(progress->>'blockId'));
  IF progress->>'phase'='content' AND (progress->'questionOpenedAt'<>'null'::jsonb OR progress->'questionClosesAt'<>'null'::jsonb) THEN RETURN false; END IF;
  IF frozen->>'kind'='question' AND (jsonb_typeof(progress->'questionOpenedAt') IS DISTINCT FROM 'string' OR progress->>'questionOpenedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$') THEN RETURN false; END IF;
  IF progress->'questionOpenedAt'<>'null'::jsonb THEN opened:=(progress->>'questionOpenedAt')::timestamptz; ELSE opened:=NULL; END IF;
  IF progress->'questionClosesAt'<>'null'::jsonb THEN
   IF jsonb_typeof(progress->'questionClosesAt') IS DISTINCT FROM 'string' OR progress->>'questionClosesAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' THEN RETURN false; END IF;
   closes:=(progress->>'questionClosesAt')::timestamptz;
   IF opened IS NULL OR closes<opened THEN RETURN false; END IF;
  END IF;
  entry:=NULLIF(progress->'recoveryPackIntervention','null'::jsonb);
  IF entry IS NOT NULL THEN
   IF progress->>'phase'<>'intervention' OR NOT openround_presentation_recovery_pack_intervention_valid(entry) THEN RETURN false; END IF;
   reference:=entry->'reference';
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(document->'recoveryPackInsertions','[]'::jsonb)) insertion
    WHERE openround_presentation_uuid_equal(insertion->>'id',reference->>'insertionId')
     AND openround_presentation_uuid_equal(insertion->>'packId',reference->>'packId')
     AND openround_presentation_uuid_equal(COALESCE(insertion->'updateBaseline'->>'packVersionId',insertion->>'packVersionId'),reference->>'packVersionId')
     AND COALESCE(insertion->'updateBaseline'->'packVersion',insertion->'packVersion')=reference->'packVersion' AND COALESCE(insertion->'updateBaseline'->>'contentHash',insertion->>'contentHash')=reference->>'contentHash'
     AND openround_presentation_uuid_equal(insertion->>'diagnosticQuestionId',frozen->'question'->>'id')
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(insertion->'updateBaseline'->'content',insertion->'originalContent')->'interventions') card WHERE openround_presentation_uuid_equal(card->>'id',reference->>'cardId'))) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION enforce_presentation_navigation_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE progress jsonb; prior jsonb; old_entry jsonb; target jsonb; current_entry jsonb; from_block jsonb; source jsonb; recheck jsonb; source_index integer; recheck_index integer; old_rank integer; new_rank integer; old_block jsonb; new_block jsonb; block_index integer; previous_block_index integer:=-1;
BEGIN
 IF NOT openround_presentation_sections_valid(NEW.content_snapshot,CASE WHEN NEW.content_snapshot->>'schemaVersion' ~ '^[0-9]{1,6}$' THEN (NEW.content_snapshot->>'schemaVersion')::integer ELSE 1 END,true)
  OR NOT openround_presentation_navigation_state_valid(NEW.content_snapshot,NEW.navigation_state) THEN RAISE EXCEPTION 'Invalid Presentation sections or navigation state' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.content_snapshot->'schemaVersion' IN ('12'::jsonb,'13'::jsonb) AND NEW.content_snapshot->'schemaVersion' IS DISTINCT FROM OLD.content_snapshot->'schemaVersion' THEN RAISE EXCEPTION 'Navigation document cannot downgrade' USING ERRCODE='23514'; END IF;
 IF COALESCE(NEW.content_snapshot->'schemaVersion','0'::jsonb) NOT IN ('12'::jsonb,'13'::jsonb) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.content_snapshot->'schemaVersion' IN ('12'::jsonb,'13'::jsonb) AND NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot THEN
  IF NEW.content_snapshot->'sections' IS DISTINCT FROM OLD.content_snapshot->'sections' THEN RAISE EXCEPTION 'Live navigation sections are frozen' USING ERRCODE='23514'; END IF;
  FOR old_block IN SELECT value FROM jsonb_array_elements(OLD.content_snapshot->'blocks') LOOP
   SELECT b.value,(b.ordinality-1)::integer INTO new_block,block_index FROM jsonb_array_elements(NEW.content_snapshot->'blocks') WITH ORDINALITY b WHERE openround_presentation_uuid_equal(b.value->>'id',old_block->>'id');
   IF new_block IS DISTINCT FROM old_block OR block_index<=previous_block_index THEN RAISE EXCEPTION 'Live navigation insertions preserve existing frozen blocks and order' USING ERRCODE='23514'; END IF;
   previous_block_index:=block_index;
  END LOOP;
 END IF;

 target:=NEW.content_snapshot->'blocks'->NEW.current_block_index;
 SELECT p INTO current_entry FROM jsonb_array_elements(NEW.navigation_state->'blocks') p WHERE openround_presentation_uuid_equal(p->>'blockId',target->>'id');
 IF NEW.phase NOT IN('lobby','finished') AND (current_entry IS NULL OR current_entry->>'phase' IS DISTINCT FROM NEW.phase) THEN RAISE EXCEPTION 'Current phase requires matching navigation progress' USING ERRCODE='23514'; END IF;
 IF NEW.phase='question_open' AND ((current_entry->>'questionOpenedAt')::timestamptz IS DISTINCT FROM NEW.question_opened_at OR (current_entry->>'questionClosesAt')::timestamptz IS DISTINCT FROM NEW.question_closes_at) THEN RAISE EXCEPTION 'Navigation must retain the original question window' USING ERRCODE='23514'; END IF;
 IF NEW.phase='intervention' AND NULLIF(current_entry->'recoveryPackIntervention','null'::jsonb) IS DISTINCT FROM NEW.recovery_pack_intervention THEN RAISE EXCEPTION 'Navigation must retain the selected intervention' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR COALESCE(OLD.content_snapshot->'schemaVersion','0'::jsonb) NOT IN ('12'::jsonb,'13'::jsonb) THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.navigation_state->'blocks') p WHERE NOT openround_presentation_uuid_equal(p->>'blockId',target->>'id')) OR (NEW.phase='lobby' AND jsonb_array_length(NEW.navigation_state->'blocks')<>0) THEN RAISE EXCEPTION 'Initial navigation cannot invent visited blocks' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.navigation_state IS DISTINCT FROM OLD.navigation_state AND NEW.revision<=OLD.revision THEN RAISE EXCEPTION 'Navigation progress requires the revision fence' USING ERRCODE='23514'; END IF;
 from_block:=OLD.content_snapshot->'blocks'->OLD.current_block_index;
 IF OLD.phase='question_open' AND (NEW.current_block_index<>OLD.current_block_index OR NEW.phase<>'question_reveal') AND (NEW.phase IS DISTINCT FROM OLD.phase OR NEW.current_block_index IS DISTINCT FROM OLD.current_block_index OR NEW.navigation_state IS DISTINCT FROM OLD.navigation_state) THEN RAISE EXCEPTION 'Reveal an open question before leaving it' USING ERRCODE='23514'; END IF;
 IF OLD.navigation_state->>'returnBlockId' IS NOT NULL AND NEW.navigation_state->>'returnBlockId' IS NOT NULL AND NOT openround_presentation_uuid_equal(OLD.navigation_state->>'returnBlockId',NEW.navigation_state->>'returnBlockId') THEN RAISE EXCEPTION 'Original return target is immutable during a detour' USING ERRCODE='23514'; END IF;
 IF OLD.navigation_state->>'returnBlockId' IS NOT NULL AND NEW.navigation_state->>'returnBlockId' IS NULL AND NOT openround_presentation_uuid_equal(OLD.navigation_state->>'returnBlockId',target->>'id') THEN RAISE EXCEPTION 'Return must restore its original target' USING ERRCODE='23514'; END IF;
 IF OLD.navigation_state->>'returnBlockId' IS NULL AND NEW.navigation_state->>'returnBlockId' IS NOT NULL AND NOT openround_presentation_uuid_equal(NEW.navigation_state->>'returnBlockId',COALESCE(from_block->>'id',NEW.content_snapshot->'blocks'->0->>'id')) THEN RAISE EXCEPTION 'Detour must retain its original path target' USING ERRCODE='23514'; END IF;

 IF NEW.current_block_index IS DISTINCT FROM OLD.current_block_index THEN
  IF target->'question'->>'delivery'='recheck' AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(NEW.content_snapshot->'blocks') diagnostic
   JOIN jsonb_array_elements(OLD.navigation_state->'blocks') visited ON openround_presentation_uuid_equal(visited->>'blockId',diagnostic->>'id')
   WHERE openround_presentation_uuid_equal(diagnostic->'question'->>'linkedRecheckQuestionId',target->'question'->>'id') AND visited->>'phase' IN('question_reveal','intervention')) THEN RAISE EXCEPTION 'A recheck requires its closed linked diagnostic' USING ERRCODE='23514'; END IF;
  IF NEW.current_block_index<>OLD.current_block_index+1 AND OLD.phase<>'lobby' THEN
   IF target->'question'->>'delivery'='recheck' AND NOT(openround_presentation_uuid_equal(OLD.navigation_state->>'returnBlockId',target->>'id') AND NEW.navigation_state->>'returnBlockId' IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.navigation_state->'blocks') p WHERE openround_presentation_uuid_equal(p->>'blockId',target->>'id') AND p->>'phase' IN('question_reveal','intervention'))) THEN RAISE EXCEPTION 'Jump cannot target a linked recheck directly' USING ERRCODE='23514'; END IF;
  END IF;
  FOR source,source_index IN SELECT b.value,(b.ordinality-1)::integer FROM jsonb_array_elements(NEW.content_snapshot->'blocks') WITH ORDINALITY b WHERE b.value->'question'->>'linkedRecheckQuestionId' IS NOT NULL LOOP
   SELECT b.value,(b.ordinality-1)::integer INTO recheck,recheck_index FROM jsonb_array_elements(NEW.content_snapshot->'blocks') WITH ORDINALITY b WHERE openround_presentation_uuid_equal(b.value->'question'->>'id',source->'question'->>'linkedRecheckQuestionId');
   SELECT p INTO prior FROM jsonb_array_elements(OLD.navigation_state->'blocks') p WHERE openround_presentation_uuid_equal(p->>'blockId',source->>'id');
   IF source_index<NEW.current_block_index AND NEW.current_block_index<=recheck_index AND (prior IS NULL OR prior->>'phase' NOT IN('question_reveal','intervention')) THEN RAISE EXCEPTION 'Navigation cannot enter an unvisited linked pair interval' USING ERRCODE='23514'; END IF;
   IF NEW.current_block_index<>OLD.current_block_index+1 AND prior->>'phase' IN('question_reveal','intervention') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.navigation_state->'blocks') p WHERE openround_presentation_uuid_equal(p->>'blockId',recheck->>'id') AND p->>'phase' IN('question_reveal','intervention')) THEN RAISE EXCEPTION 'Complete the pending linked recheck before navigating away' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 FOR old_entry IN SELECT value FROM jsonb_array_elements(OLD.navigation_state->'blocks') LOOP
  SELECT p INTO progress FROM jsonb_array_elements(NEW.navigation_state->'blocks') p WHERE openround_presentation_uuid_equal(p->>'blockId',old_entry->>'blockId');
  old_rank:=CASE old_entry->>'phase' WHEN 'question_reveal' THEN 1 WHEN 'intervention' THEN 2 ELSE 0 END;
  new_rank:=CASE progress->>'phase' WHEN 'question_reveal' THEN 1 WHEN 'intervention' THEN 2 ELSE 0 END;
  IF progress IS NULL OR new_rank<old_rank OR progress->'questionOpenedAt' IS DISTINCT FROM old_entry->'questionOpenedAt' OR progress->'questionClosesAt' IS DISTINCT FROM old_entry->'questionClosesAt'
   OR (old_entry->>'phase'='intervention' AND progress->'recoveryPackIntervention' IS DISTINCT FROM old_entry->'recoveryPackIntervention')
   OR (progress IS DISTINCT FROM old_entry AND NOT openround_presentation_uuid_equal(progress->>'blockId',target->>'id')) THEN RAISE EXCEPTION 'Navigation progress is monotonic and preserves accepted attempts' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR progress IN SELECT value FROM jsonb_array_elements(NEW.navigation_state->'blocks') LOOP
  SELECT p INTO prior FROM jsonb_array_elements(OLD.navigation_state->'blocks') p WHERE openround_presentation_uuid_equal(p->>'blockId',progress->>'blockId');
  IF prior IS NULL AND target->>'kind'='question' AND openround_presentation_uuid_equal(progress->>'blockId',target->>'id') AND NEW.phase<>'question_open' THEN RAISE EXCEPTION 'An unvisited question requires its original open attempt' USING ERRCODE='23514'; END IF;
  IF prior IS NULL AND NOT openround_presentation_uuid_equal(progress->>'blockId',target->>'id') THEN RAISE EXCEPTION 'Only the presented target can become visited' USING ERRCODE='23514'; END IF;
  IF prior IS NOT NULL AND NEW.phase='question_open' AND openround_presentation_uuid_equal(progress->>'blockId',target->>'id') AND (OLD.phase<>'question_open' OR OLD.current_block_index<>NEW.current_block_index) THEN RAISE EXCEPTION 'A visited question cannot reopen' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_presentation_navigation_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room presentation_live_sessions%ROWTYPE;
BEGIN
 SELECT * INTO room FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
 IF room.content_snapshot->'schemaVersion' IN ('12'::jsonb,'13'::jsonb) AND NEW.event_type IN('question.launched','question.revealed') AND EXISTS(SELECT 1 FROM presentation_session_timeline t WHERE t.session_id=NEW.session_id AND t.block_id=NEW.block_id AND t.event_type=NEW.event_type AND t.id<>NEW.id) THEN RAISE EXCEPTION 'A visited question cannot launch or reveal again' USING ERRCODE='23514'; END IF;
 IF NEW.event_type NOT IN('navigation.jumped','navigation.returned','navigation.revisited','navigation.branched') THEN
  IF NEW.navigation IS NOT NULL THEN RAISE EXCEPTION 'Navigation metadata requires a navigation event' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO room FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
 IF COALESCE(room.content_snapshot->'schemaVersion','0'::jsonb) NOT IN ('12'::jsonb,'13'::jsonb) OR NEW.navigation IS NULL OR jsonb_typeof(NEW.navigation) IS DISTINCT FROM 'object'
  OR (NEW.navigation-ARRAY['fromBlockId','toBlockId','returnBlockId','restored'])<>'{}'::jsonb OR NOT(NEW.navigation ?& ARRAY['fromBlockId','toBlockId','returnBlockId','restored'])
  OR jsonb_typeof(NEW.navigation->'restored') IS DISTINCT FROM 'boolean'
  OR NOT COALESCE(openround_presentation_uuid_equal(NEW.navigation->>'toBlockId',NEW.block_id::text),false)
  OR NEW.block_index IS DISTINCT FROM room.current_block_index
  OR NOT COALESCE(openround_presentation_uuid_equal(NEW.block_id::text,room.content_snapshot->'blocks'->room.current_block_index->>'id'),false)
  OR NEW.navigation->'returnBlockId' IS DISTINCT FROM room.navigation_state->'returnBlockId'
  OR (NEW.navigation->'fromBlockId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(room.content_snapshot->'blocks') b WHERE openround_presentation_uuid_equal(b->>'id',NEW.navigation->>'fromBlockId'))) THEN RAISE EXCEPTION 'Invalid durable navigation event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_presentation_navigation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room presentation_live_sessions%ROWTYPE;
BEGIN
 IF NEW.event_type IN('navigation.jumped','navigation.returned','navigation.revisited','navigation.branched','scene.reveal_changed') AND (NEW.request_hash IS NULL OR NEW.request_hash !~ '^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'Navigation commands require an intent fingerprint' USING ERRCODE='23514'; END IF;
 IF NEW.event_type IN('navigation.jumped','navigation.returned','navigation.revisited','navigation.branched','scene.reveal_changed') THEN
  SELECT * INTO room FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
  IF COALESCE(room.content_snapshot->'schemaVersion','0'::jsonb) NOT IN ('12'::jsonb,'13'::jsonb) OR (NEW.event_type IN ('scene.reveal_changed','navigation.branched') AND room.content_snapshot->'schemaVersion' IS DISTINCT FROM '13'::jsonb) THEN RAISE EXCEPTION 'Navigation receipts require document version 12' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION openround_presentation_advanced_scene_valid(scene jsonb,published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; converted jsonb:='[]'; image jsonb; legacy jsonb;
BEGIN
 IF jsonb_typeof(scene) IS DISTINCT FROM 'object' OR scene->'schemaVersion' IS DISTINCT FROM '6'::jsonb OR openround_presentation_json_bytes(scene)>131072 OR jsonb_typeof(scene->'nodes') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR node IN SELECT value FROM jsonb_array_elements(scene->'nodes') LOOP
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
      OR (node->'frame'->>'x')::numeric+(node->'frame'->>'width')::numeric>(image->'frame'->>'x')::numeric+(image->'frame'->>'width')::numeric
      OR (node->'frame'->>'y')::numeric+(node->'frame'->>'height')::numeric>(image->'frame'->>'y')::numeric+(image->'frame'->>'height')::numeric THEN RETURN false; END IF;
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
 legacy:=scene||jsonb_build_object('schemaVersion',5,'nodes',converted);
 RETURN openround_presentation_interaction_scene_valid(legacy,published);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;

CREATE FUNCTION openround_presentation_interaction_target_valid(document jsonb,target_id text,source_index integer,forward_only boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE target jsonb; target_index integer;
BEGIN
 SELECT b.value,(b.ordinality-1)::integer INTO target,target_index FROM jsonb_array_elements(document->'blocks') WITH ORDINALITY b WHERE openround_presentation_uuid_equal(b.value->>'id',target_id);
 IF target IS NULL OR target_index=source_index OR (forward_only AND target_index<=source_index) OR target->'hidden'='true'::jsonb OR target->'question'->>'delivery'='recheck' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(document->'blocks') WITH ORDINALITY source JOIN jsonb_array_elements(document->'blocks') WITH ORDINALITY recheck ON recheck.value->'question'->>'id'=source.value->'question'->>'linkedRecheckQuestionId' WHERE target_index>source.ordinality-1 AND target_index<recheck.ordinality-1) THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION openround_presentation_advanced_interactions_valid(document jsonb,stored_version integer,published boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE block jsonb; node jsonb; branch jsonb; condition jsonb; index integer; broadcast_count integer:=0; ids text[]:='{}';
BEGIN
 IF jsonb_typeof(document->'blocks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR block,index IN SELECT b.value,(b.ordinality-1)::integer FROM jsonb_array_elements(document->'blocks') WITH ORDINALITY b LOOP
  IF block->'scene'->'schemaVersion'='6'::jsonb THEN
   IF document->'schemaVersion' IS DISTINCT FROM '13'::jsonb OR stored_version IS DISTINCT FROM 13 OR NOT openround_presentation_advanced_scene_valid(block->'scene',published) THEN RETURN false; END IF;
  END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(block->'scene'->'nodes')='array' THEN block->'scene'->'nodes' ELSE '[]'::jsonb END) LOOP
   IF node->>'type' IN('hotspot','dialog','navigation') OR (node->>'type'='reveal' AND node->>'scope'='broadcast') THEN
    IF block->'scene'->'schemaVersion' IS DISTINCT FROM '6'::jsonb OR document->'schemaVersion' IS DISTINCT FROM '13'::jsonb OR stored_version IS DISTINCT FROM 13 THEN RETURN false; END IF;
   END IF;
   IF node->>'type'='reveal' AND node->>'scope'='broadcast' THEN broadcast_count:=broadcast_count+1; END IF;
   IF published AND node->>'type'='navigation' AND NOT openround_presentation_interaction_target_valid(document,node->>'targetBlockId',index,false) THEN RETURN false; END IF;
  END LOOP;
  IF NOT(block ? 'branches') THEN CONTINUE; END IF;
  IF document->'schemaVersion' IS DISTINCT FROM '13'::jsonb OR stored_version IS DISTINCT FROM 13 OR block->>'kind' IS DISTINCT FROM 'question'
   OR COALESCE(block->'question'->>'delivery','main')<>'main' OR block->'question'->>'linkedRecheckQuestionId' IS NOT NULL
   OR jsonb_typeof(block->'branches') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(block->'branches')>10 THEN RETURN false; END IF;
  FOR branch IN SELECT value FROM jsonb_array_elements(block->'branches') LOOP
   IF jsonb_typeof(branch) IS DISTINCT FROM 'object' OR (branch-ARRAY['id','label','condition','targetBlockId'])<>'{}'::jsonb
    OR NOT(branch ?& ARRAY['id','label','condition','targetBlockId']) OR NOT COALESCE(openround_presentation_uuid_equal(branch->>'id',branch->>'id'),false) OR lower(branch->>'id')=ANY(ids)
    OR NOT COALESCE(openround_presentation_plain_text_valid(branch->'label',120,published,true),false) OR visual_import_utf16_length(branch->>'label')>120
    OR (branch->'targetBlockId'='null'::jsonb AND published) OR (branch->'targetBlockId'<>'null'::jsonb AND NOT COALESCE(openround_presentation_uuid_equal(branch->>'targetBlockId',branch->>'targetBlockId'),false)) THEN RETURN false; END IF;
   ids:=array_append(ids,lower(branch->>'id')); condition:=branch->'condition';
   IF jsonb_typeof(condition) IS DISTINCT FROM 'object' OR NOT(condition ?& ARRAY['kind','minPercent','minResponses']) OR jsonb_typeof(condition->'minPercent') IS DISTINCT FROM 'number' OR (condition->>'minPercent')::numeric NOT BETWEEN 0 AND 100
    OR jsonb_typeof(condition->'minResponses') IS DISTINCT FROM 'number' OR condition->>'minResponses' !~ '^[1-9][0-9]{0,4}$' OR (condition->>'minResponses')::integer>10000 THEN RETURN false; END IF;
   IF condition->>'kind'='choice_share' THEN
    IF (condition-ARRAY['kind','choiceId','minPercent','minResponses'])<>'{}'::jsonb OR block->'question'->>'type' NOT IN('single_select','true_false','multi_select','poll')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(block->'question'->'choices','[]'::jsonb)) choice WHERE openround_presentation_uuid_equal(choice->>'id',condition->>'choiceId')) THEN RETURN false; END IF;
   ELSIF condition->>'kind'='correct_share' THEN
    IF (condition-ARRAY['kind','minPercent','minResponses'])<>'{}'::jsonb OR block->'question'->>'type' NOT IN('single_select','true_false','multi_select','numeric') THEN RETURN false; END IF;
   ELSE RETURN false;
   END IF;
   IF published AND NOT openround_presentation_interaction_target_valid(document,branch->>'targetBlockId',index,true) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN broadcast_count<=200;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
ALTER TABLE presentations ADD CONSTRAINT presentations_advanced_interactions_check CHECK(openround_presentation_advanced_interactions_valid(draft,draft_schema_version,false)) NOT VALID;
ALTER TABLE presentation_draft_history ADD CONSTRAINT presentation_history_advanced_interactions_check CHECK(openround_presentation_advanced_interactions_valid(draft,draft_schema_version,false)) NOT VALID;
ALTER TABLE presentation_versions ADD CONSTRAINT presentation_versions_advanced_interactions_check CHECK(openround_presentation_advanced_interactions_valid(content,content_schema_version,true)) NOT VALID;

CREATE FUNCTION openround_presentation_interaction_state_valid(document jsonb,state jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; seen text[]:='{}'; identity text;
BEGIN
 IF document->'schemaVersion' IS DISTINCT FROM '13'::jsonb THEN RETURN state IS NULL; END IF;
 IF state IS NULL OR jsonb_typeof(state) IS DISTINCT FROM 'object' OR (state-ARRAY['reveals'])<>'{}'::jsonb OR jsonb_typeof(state->'reveals') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(state->'reveals')>200 THEN RETURN false; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(state->'reveals') LOOP
  identity:=lower(entry->>'blockId')||':'||(entry->>'nodeId');
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR (entry-ARRAY['blockId','nodeId','revealed'])<>'{}'::jsonb OR NOT(entry ?& ARRAY['blockId','nodeId','revealed']) OR identity=ANY(seen)
   OR jsonb_typeof(entry->'revealed') IS DISTINCT FROM 'boolean' OR NOT COALESCE(openround_presentation_plain_text_valid(entry->'nodeId',200,true,true),false)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'blocks') block CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(block->'scene'->'nodes')='array' THEN block->'scene'->'nodes' ELSE '[]'::jsonb END) node WHERE openround_presentation_uuid_equal(block->>'id',entry->>'blockId') AND node->>'id'=entry->>'nodeId' AND node->>'type'='reveal' AND node->>'scope'='broadcast') THEN RETURN false; END IF;
  seen:=array_append(seen,identity);
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION enforce_presentation_advanced_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; entry jsonb; changed integer:=0; current_id text;
BEGIN
 IF NOT openround_presentation_advanced_interactions_valid(NEW.content_snapshot,CASE WHEN NEW.content_snapshot->>'schemaVersion' ~ '^[0-9]{1,6}$' THEN (NEW.content_snapshot->>'schemaVersion')::integer ELSE 1 END,true) OR NOT openround_presentation_interaction_state_valid(NEW.content_snapshot,NEW.interaction_state) THEN RAISE EXCEPTION 'Invalid advanced Presentation content or interaction state' USING ERRCODE='23514'; END IF;
 IF NEW.content_snapshot->'schemaVersion' IS DISTINCT FROM '13'::jsonb THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF jsonb_array_length(NEW.interaction_state->'reveals')<>0 THEN RAISE EXCEPTION 'Initial interaction state cannot invent reveals' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.interaction_state IS NOT DISTINCT FROM OLD.interaction_state THEN RETURN NEW; END IF;
 IF OLD.status<>'active' OR NEW.status<>OLD.status OR OLD.phase<>'content' OR NEW.phase<>OLD.phase OR NEW.current_block_index<>OLD.current_block_index OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Reveals require a fenced current active content block' USING ERRCODE='23514'; END IF;
 current_id:=NEW.content_snapshot->'blocks'->NEW.current_block_index->>'id';
 FOR prior IN SELECT value FROM jsonb_array_elements(OLD.interaction_state->'reveals') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.interaction_state->'reveals') item WHERE openround_presentation_uuid_equal(item->>'blockId',prior->>'blockId') AND item->>'nodeId'=prior->>'nodeId') THEN RAISE EXCEPTION 'Shared reveal history cannot be removed' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(NEW.interaction_state->'reveals') LOOP
  SELECT item INTO prior FROM jsonb_array_elements(OLD.interaction_state->'reveals') item WHERE openround_presentation_uuid_equal(item->>'blockId',entry->>'blockId') AND item->>'nodeId'=entry->>'nodeId';
  IF prior IS NOT DISTINCT FROM entry THEN CONTINUE; END IF;
  IF NOT openround_presentation_uuid_equal(entry->>'blockId',current_id) OR (prior IS NULL AND entry->'revealed'='false'::jsonb) OR (prior IS NOT NULL AND prior->'revealed'=entry->'revealed') THEN RAISE EXCEPTION 'Reveal must change its current frozen node state' USING ERRCODE='23514'; END IF;
  changed:=changed+1;
 END LOOP;
 IF changed<>1 THEN RAISE EXCEPTION 'A reveal command changes exactly one node' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_advanced_session BEFORE INSERT OR UPDATE OF content_snapshot,interaction_state,phase,status,current_block_index,revision ON presentation_live_sessions FOR EACH ROW EXECUTE FUNCTION enforce_presentation_advanced_session();

CREATE FUNCTION enforce_presentation_advanced_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room presentation_live_sessions%ROWTYPE; entry jsonb; prior_event jsonb; source jsonb; branch_rule jsonb; denominator integer; matched integer;
BEGIN
 IF NEW.event_type NOT IN('scene.reveal_changed','navigation.branched') THEN
  IF NEW.interaction IS NOT NULL OR NEW.branch IS NOT NULL THEN RAISE EXCEPTION 'Advanced metadata requires its accepted event type' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO room FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
 IF room.content_snapshot->'schemaVersion' IS DISTINCT FROM '13'::jsonb THEN RAISE EXCEPTION 'Advanced events require document13' USING ERRCODE='23514'; END IF;
 IF NEW.event_type='scene.reveal_changed' THEN
  entry:=NEW.interaction;
  SELECT t.interaction INTO prior_event FROM presentation_session_timeline t WHERE t.session_id=NEW.session_id AND t.event_type='scene.reveal_changed' AND t.block_id=NEW.block_id AND t.interaction->>'nodeId'=entry->>'nodeId' AND t.id<>NEW.id ORDER BY t.sequence DESC LIMIT 1;
  IF COALESCE(prior_event->'revealed','false'::jsonb)=entry->'revealed' THEN RAISE EXCEPTION 'A reveal event requires an actual state change' USING ERRCODE='23514'; END IF;
  IF room.status<>'active' OR room.phase<>'content' OR NEW.block_index IS DISTINCT FROM room.current_block_index OR NEW.branch IS NOT NULL OR entry IS NULL OR jsonb_typeof(entry) IS DISTINCT FROM 'object' OR (entry-ARRAY['blockId','nodeId','revealed'])<>'{}'::jsonb OR NOT(entry ?& ARRAY['blockId','nodeId','revealed'])
   OR NOT openround_presentation_uuid_equal(entry->>'blockId',NEW.block_id::text) OR NOT openround_presentation_uuid_equal(NEW.block_id::text,room.content_snapshot->'blocks'->room.current_block_index->>'id')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(room.interaction_state->'reveals') item WHERE openround_presentation_uuid_equal(item->>'blockId',entry->>'blockId') AND item->>'nodeId'=entry->>'nodeId' AND item->'revealed'=entry->'revealed') THEN RAISE EXCEPTION 'Invalid current reveal event' USING ERRCODE='23514'; END IF;
 ELSE
  entry:=NEW.branch;
  IF NEW.interaction IS NOT NULL OR entry IS NULL OR jsonb_typeof(entry) IS DISTINCT FROM 'object' OR (entry-ARRAY['branchId','sourceBlockId','targetBlockId','denominator','matchedResponses'])<>'{}'::jsonb OR NOT(entry ?& ARRAY['branchId','sourceBlockId','targetBlockId','denominator','matchedResponses']) OR NEW.navigation IS NULL
   OR NOT openround_presentation_uuid_equal(entry->>'sourceBlockId',NEW.navigation->>'fromBlockId') OR NOT openround_presentation_uuid_equal(entry->>'targetBlockId',NEW.block_id::text) THEN RAISE EXCEPTION 'Invalid branch navigation metadata' USING ERRCODE='23514'; END IF;
  SELECT block INTO source FROM jsonb_array_elements(room.content_snapshot->'blocks') block WHERE openround_presentation_uuid_equal(block->>'id',entry->>'sourceBlockId');
  SELECT rule INTO branch_rule FROM jsonb_array_elements(COALESCE(source->'branches','[]'::jsonb)) rule WHERE openround_presentation_uuid_equal(rule->>'id',entry->>'branchId');
  IF branch_rule IS NULL OR NOT openround_presentation_uuid_equal(branch_rule->>'targetBlockId',entry->>'targetBlockId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(room.navigation_state->'blocks') progress WHERE openround_presentation_uuid_equal(progress->>'blockId',source->>'id') AND progress->>'phase'='question_reveal') THEN RAISE EXCEPTION 'A branch requires its revealed frozen source' USING ERRCODE='23514'; END IF;
  SELECT count(*)::integer,count(*) FILTER(WHERE CASE WHEN branch_rule->'condition'->>'kind'='correct_share' THEN response.correct IS TRUE ELSE EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(response.response->'choiceIds','[]'::jsonb)) AS selected(value) WHERE openround_presentation_uuid_equal(selected.value,branch_rule->'condition'->>'choiceId')) END)::integer INTO denominator,matched FROM presentation_live_responses response WHERE response.session_id=room.id AND response.block_id=(source->>'id')::uuid AND (branch_rule->'condition'->>'kind'<>'correct_share' OR response.correct IS NOT NULL);
  IF entry->'denominator' IS DISTINCT FROM to_jsonb(denominator) OR entry->'matchedResponses' IS DISTINCT FROM to_jsonb(matched) OR denominator<(branch_rule->'condition'->>'minResponses')::integer OR matched*100<denominator*(branch_rule->'condition'->>'minPercent')::numeric THEN RAISE EXCEPTION 'Branch condition must match accepted frozen responses' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_advanced_timeline BEFORE INSERT OR UPDATE ON presentation_session_timeline FOR EACH ROW EXECUTE FUNCTION enforce_presentation_advanced_timeline();
