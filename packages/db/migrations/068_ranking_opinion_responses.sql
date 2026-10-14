-- Rankings retain their ordered response meaning in new artifact and response versions.
-- Keep compatible schema-3/4 readers deployed when pausing the new writer rollout.
ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS quizzes_ranking_version_check;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_ranking_version_check CHECK (
  draft_schema_version >= 3 OR NOT jsonb_path_exists(draft, '$.questions[*] ? (@.type == "ranking")')
);
ALTER TABLE quiz_draft_history DROP CONSTRAINT IF EXISTS quiz_history_ranking_version_check;
ALTER TABLE quiz_draft_history ADD CONSTRAINT quiz_history_ranking_version_check CHECK (
  draft_schema_version >= 3 OR NOT jsonb_path_exists(draft, '$.questions[*] ? (@.type == "ranking")')
);
ALTER TABLE quiz_versions DROP CONSTRAINT IF EXISTS quiz_versions_ranking_version_check;
ALTER TABLE quiz_versions ADD CONSTRAINT quiz_versions_ranking_version_check CHECK (
  content_schema_version >= 3 OR NOT jsonb_path_exists(content, '$.questions[*] ? (@.type == "ranking")')
);
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_ranking_version_check;
ALTER TABLE answers ADD CONSTRAINT answers_ranking_version_check CHECK (
  response_schema_version >= 4 OR response_payload->>'kind' <> 'ranking'
);
ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS game_sessions_ranking_version_check;
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_ranking_version_check CHECK (
  state_schema_version >= 8 OR NOT jsonb_path_exists(state_snapshot, '$.quiz.questions[*] ? (@.type == "ranking")')
);
