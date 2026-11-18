-- Metadata discovery reads mutable parents only; published versions stay immutable.
-- ICU root lowercase makes title ordering independent of the cluster/user locale.
CREATE INDEX quizzes_library_recent_idx ON quizzes(workspace_id, updated_at DESC, id);
CREATE INDEX presentations_library_recent_idx ON presentations(workspace_id, updated_at DESC, id);
CREATE INDEX surveys_library_recent_idx ON surveys(workspace_id, updated_at DESC, id);
CREATE INDEX quizzes_library_title_idx ON quizzes(workspace_id, (lower(normalize(title, NFC) COLLATE "und-x-icu") COLLATE "C"), id);
CREATE INDEX presentations_library_title_idx ON presentations(workspace_id, (lower(normalize(title, NFC) COLLATE "und-x-icu") COLLATE "C"), id);
CREATE INDEX surveys_library_title_idx ON surveys(workspace_id, (lower(normalize((data->'draft'->>'title'), NFC) COLLATE "und-x-icu") COLLATE "C"), id);
