-- Text opinions have separate artifact/response readers and body-free moderation metadata.
-- Keep compatible schema-4/5/9 readers while pausing new writer creation.
ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS quizzes_text_opinion_version_check;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_text_opinion_version_check CHECK (
  draft_schema_version >= 4 OR NOT jsonb_path_exists(draft, '$.questions[*] ? (@.type == "open_text" || @.type == "word_cloud")')
);
ALTER TABLE quiz_draft_history DROP CONSTRAINT IF EXISTS quiz_history_text_opinion_version_check;
ALTER TABLE quiz_draft_history ADD CONSTRAINT quiz_history_text_opinion_version_check CHECK (
  draft_schema_version >= 4 OR NOT jsonb_path_exists(draft, '$.questions[*] ? (@.type == "open_text" || @.type == "word_cloud")')
);
ALTER TABLE quiz_versions DROP CONSTRAINT IF EXISTS quiz_versions_text_opinion_version_check;
ALTER TABLE quiz_versions ADD CONSTRAINT quiz_versions_text_opinion_version_check CHECK (
  content_schema_version >= 4 OR NOT jsonb_path_exists(content, '$.questions[*] ? (@.type == "open_text" || @.type == "word_cloud")')
);
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_text_opinion_version_check;
ALTER TABLE answers ADD CONSTRAINT answers_text_opinion_version_check CHECK (
  response_schema_version >= 5 OR response_payload->>'kind' <> 'text'
);
ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS game_sessions_text_opinion_version_check;
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_text_opinion_version_check CHECK (
  state_schema_version >= 9 OR (
    NOT jsonb_path_exists(state_snapshot, '$.quiz.questions[*] ? (@.type == "open_text" || @.type == "word_cloud")')
    AND NOT jsonb_path_exists(state_snapshot, '$.answers.*.response ? (@.kind == "text")')
    AND NOT (state_snapshot ? 'responseModeration')
    AND NOT (state_snapshot ? 'responseModerationReceipts')
  )
);
ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS game_sessions_text_moderation_metadata_check;
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_text_moderation_metadata_check CHECK (
  state_schema_version <> 9 OR (
    state_snapshot ? 'responseModeration' AND state_snapshot ? 'responseModerationReceipts'
    AND jsonb_typeof(state_snapshot->'responseModeration') = 'object'
    AND jsonb_typeof(state_snapshot->'responseModerationReceipts') = 'object'
    AND jsonb_array_length(jsonb_path_query_array(state_snapshot->'responseModeration', '$.*')) <= 2500
    AND jsonb_array_length(jsonb_path_query_array(state_snapshot->'responseModerationReceipts', '$.*')) <= 5000
  )
);
