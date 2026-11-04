-- Read-compatible, opt-in Presentation document 10 and private text response storage 3.
-- Existing JSON, hashes, envelope defaults, and retained response rows are unchanged.
ALTER TABLE presentation_live_sessions ADD COLUMN text_moderation_seq bigint NOT NULL DEFAULT 0 CHECK(text_moderation_seq>=0);
ALTER TABLE presentation_live_responses DROP CONSTRAINT presentation_live_responses_response_schema_version_check;
ALTER TABLE presentation_live_responses ADD CONSTRAINT presentation_live_responses_response_schema_version_check CHECK(response_schema_version IN(1,2,3));
ALTER TABLE presentation_live_responses
  ADD COLUMN text_value text,
  ADD COLUMN moderation_status text,
  ADD COLUMN moderation_version integer,
  ADD COLUMN moderated_at timestamptz;
ALTER TABLE presentation_live_responses ADD CONSTRAINT presentation_text_storage_check CHECK(
  (response_schema_version<>3 AND text_value IS NULL AND moderation_status IS NULL AND moderation_version IS NULL AND moderated_at IS NULL)
  OR (response_schema_version=3 AND response='{}'::jsonb AND correct IS NULL AND score=0
    AND moderation_status IN('pending','approved','removed') AND moderation_version>=0
    AND ((moderation_status='removed' AND text_value IS NULL) OR (moderation_status<>'removed' AND text_value IS NOT NULL)))
);
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
      IF text_count > 10 OR document_version <> 10 OR stored_version IS DISTINCT FROM 10
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
      IF document_version NOT IN (9,10) OR stored_version IS DISTINCT FROM document_version
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
    OR COALESCE(document->>'schemaVersion','') NOT IN ('9','10')
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

CREATE OR REPLACE FUNCTION openround_presentation_text_value_valid(value text, question_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT value IS NOT NULL AND value=normalize(value,NFC)
   AND value=btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
   AND (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(value,'') ch)
      BETWEEN 1 AND CASE WHEN question_type='word_cloud' THEN 80 ELSE 1000 END
   AND NOT EXISTS(SELECT 1 FROM regexp_split_to_table(value,'') ch WHERE
      (ascii(ch)<=31 OR ascii(ch) BETWEEN 127 AND 159)
      AND NOT(question_type='open_text' AND ascii(ch) IN(9,10)))
$$;

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
 IF NOT text_question OR room.content_snapshot->>'schemaVersion' IS DISTINCT FROM '10' OR NEW.response_schema_version<>3
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
CREATE TRIGGER presentation_text_response_guard BEFORE INSERT OR UPDATE ON presentation_live_responses
 FOR EACH ROW EXECUTE FUNCTION enforce_presentation_text_response();

CREATE OR REPLACE FUNCTION bump_presentation_text_moderation_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.response_schema_version=3 AND NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
  UPDATE presentation_live_sessions SET text_moderation_seq=text_moderation_seq+1,event_seq=event_seq+1
    WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_text_moderation_sequence AFTER UPDATE OF moderation_status ON presentation_live_responses
 FOR EACH ROW EXECUTE FUNCTION bump_presentation_text_moderation_sequence();

CREATE TABLE presentation_text_moderation_receipts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 session_id uuid NOT NULL, command_id uuid NOT NULL, response_id uuid NOT NULL REFERENCES presentation_live_responses(id) ON DELETE CASCADE,
 block_id uuid NOT NULL, host_credential_id uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 previous_status text NOT NULL CHECK(previous_status IN('pending','approved')),
 status text NOT NULL CHECK(status IN('approved','removed')),
 expected_revision bigint NOT NULL CHECK(expected_revision>=0), expected_moderation_version integer NOT NULL CHECK(expected_moderation_version>=0),
 resulting_moderation_version integer NOT NULL CHECK(resulting_moderation_version=expected_moderation_version+1),
 accepted_at timestamptz NOT NULL,
 UNIQUE(session_id,command_id), UNIQUE(response_id,resulting_moderation_version), FOREIGN KEY(workspace_id,session_id) REFERENCES presentation_live_sessions(workspace_id,id) ON DELETE CASCADE,
 CHECK(previous_status<>'approved' OR status='removed')
);
ALTER TABLE presentation_text_moderation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_text_moderation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_text_moderation_receipts USING(
 current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),'')
) WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT ON presentation_text_moderation_receipts TO openround_runtime;
END IF; END $$;

CREATE OR REPLACE FUNCTION enforce_presentation_text_command_namespace()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent record;
BEGIN
 SELECT * INTO parent FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
 IF TG_TABLE_NAME='presentation_text_moderation_receipts' THEN
  IF EXISTS(SELECT 1 FROM presentation_session_command_receipts WHERE session_id=NEW.session_id AND command_id=NEW.command_id)
   OR NOT EXISTS(SELECT 1 FROM presentation_live_responses WHERE id=NEW.response_id AND workspace_id=NEW.workspace_id AND session_id=NEW.session_id AND block_id=NEW.block_id AND response_schema_version=3 AND moderation_status=NEW.status AND moderation_version=NEW.resulting_moderation_version)
   OR NOT EXISTS(SELECT 1 FROM presentation_session_credentials WHERE workspace_id=NEW.workspace_id AND session_id=NEW.session_id AND id=NEW.host_credential_id AND role='host' AND revoked_at IS NULL AND expires_at>clock_timestamp())
   OR parent.revision<>NEW.expected_revision
   OR (SELECT count(*) FROM presentation_text_moderation_receipts WHERE session_id=NEW.session_id)>=5000 THEN
   RAISE EXCEPTION 'Invalid text moderation receipt or command namespace' USING ERRCODE='23514';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM presentation_text_moderation_receipts WHERE session_id=NEW.session_id AND command_id=NEW.command_id) THEN
   RAISE EXCEPTION 'Command identifier belongs to text moderation' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_text_command_namespace BEFORE INSERT ON presentation_text_moderation_receipts FOR EACH ROW EXECUTE FUNCTION enforce_presentation_text_command_namespace();
CREATE TRIGGER presentation_command_text_namespace BEFORE INSERT ON presentation_session_command_receipts FOR EACH ROW EXECUTE FUNCTION enforce_presentation_text_command_namespace();

CREATE OR REPLACE FUNCTION enforce_presentation_text_room_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; room_id uuid; capacity_limit integer;
BEGIN
 IF TG_TABLE_NAME='presentation_live_participants' THEN
  -- Joins already need an exclusive parent fence for the compatibility sequence update.
  -- Acquire it before classification so concurrent promotion cannot admit a 251st person.
  SELECT content_snapshot INTO document FROM presentation_live_sessions WHERE workspace_id=NEW.workspace_id AND id=NEW.session_id FOR UPDATE;
  room_id:=NEW.session_id; capacity_limit:=250;
 ELSE document:=NEW.content_snapshot; room_id:=NEW.id; capacity_limit:=251;
 END IF;
 IF jsonb_path_exists(document,'$.blocks[*].question ? (@.type == "open_text" || @.type == "word_cloud")')
  AND (SELECT count(*) FROM presentation_live_participants WHERE session_id=room_id) >= capacity_limit THEN
  RAISE EXCEPTION 'Text opinion rooms support at most 250 participants' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_text_room_join_capacity BEFORE INSERT ON presentation_live_participants FOR EACH ROW EXECUTE FUNCTION enforce_presentation_text_room_capacity();
CREATE TRIGGER presentation_text_room_content_capacity BEFORE INSERT OR UPDATE OF content_snapshot ON presentation_live_sessions FOR EACH ROW EXECUTE FUNCTION enforce_presentation_text_room_capacity();

-- Extend the existing compatibility/import fence by exactly the independent moderation counter.
-- Ordinary rooms retain text_moderation_seq=0; expiry checks and imported-offset arithmetic are
-- preserved verbatim from migration 040, while reveal/finish after moderation share one domain.
CREATE OR REPLACE FUNCTION reconcile_presentation_timeline_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stored_sequence bigint;
  effective_sequence bigint;
  target_sequence bigint;
  readable_session boolean;
BEGIN
  SELECT session.event_seq,
         session.event_seq_offset
           + session.revision
           + session.text_moderation_seq
           + (SELECT count(*)
                FROM presentation_live_participants AS participant
               WHERE participant.session_id = session.id)
           + (SELECT count(*)
                FROM presentation_live_responses AS response
               WHERE response.session_id = session.id),
         session.live_expires_at > now()
    INTO stored_sequence, effective_sequence, readable_session
    FROM presentation_live_sessions AS session
   WHERE session.workspace_id = NEW.workspace_id
     AND session.id = NEW.session_id
   FOR UPDATE OF session;

  IF effective_sequence IS NULL THEN
    RAISE EXCEPTION 'presentation session does not exist' USING ERRCODE = '23503';
  END IF;

  target_sequence := GREATEST(NEW.sequence, stored_sequence, effective_sequence);
  IF readable_session AND target_sequence > effective_sequence THEN
    RAISE EXCEPTION
      'cannot import a Presentation event sequence above the unexpired aggregate fence'
      USING ERRCODE = '23514';
  END IF;

  UPDATE presentation_live_sessions
     SET event_seq_offset = event_seq_offset + (target_sequence - effective_sequence),
         event_seq = target_sequence
   WHERE workspace_id = NEW.workspace_id
     AND id = NEW.session_id;
  NEW.sequence := target_sequence;

  RETURN NEW;
END;
$$;
