-- Keep legacy artifact/response meanings narrow while deploying compatible readers first.
-- Rollback disables new extended-poll writers; accepted schema-2 artifacts and schema-3
-- answers require the compatible readers and this additive migration to remain deployed.
ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS quizzes_extended_poll_version_check;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_extended_poll_version_check CHECK (
  draft_schema_version >= 2 OR NOT jsonb_path_exists(
    draft, '$.questions[*] ? (@.type == "poll" && @.maxSelections > 1)'
  )
);
ALTER TABLE quiz_draft_history DROP CONSTRAINT IF EXISTS quiz_history_extended_poll_version_check;
ALTER TABLE quiz_draft_history ADD CONSTRAINT quiz_history_extended_poll_version_check CHECK (
  draft_schema_version >= 2 OR NOT jsonb_path_exists(
    draft, '$.questions[*] ? (@.type == "poll" && @.maxSelections > 1)'
  )
);
ALTER TABLE quiz_versions DROP CONSTRAINT IF EXISTS quiz_versions_extended_poll_version_check;
ALTER TABLE quiz_versions ADD CONSTRAINT quiz_versions_extended_poll_version_check CHECK (
  content_schema_version >= 2 OR NOT jsonb_path_exists(
    content, '$.questions[*] ? (@.type == "poll" && @.maxSelections > 1)'
  )
);
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_extended_poll_version_check;
ALTER TABLE answers ADD CONSTRAINT answers_extended_poll_version_check CHECK (
  response_schema_version >= 3 OR response_payload->>'kind' <> 'poll'
  OR jsonb_array_length(response_payload->'choiceIds') <= 1
);
