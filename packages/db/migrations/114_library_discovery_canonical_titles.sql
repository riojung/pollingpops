-- Preserve already-applied migration 113. Lowercasing can introduce combining
-- sequences; normalize again to match canonical search and cursor keys.
DROP INDEX quizzes_library_title_idx;
DROP INDEX presentations_library_title_idx;
DROP INDEX surveys_library_title_idx;

CREATE INDEX quizzes_library_title_idx ON quizzes(workspace_id, (normalize(lower(normalize(title, NFC) COLLATE "und-x-icu"), NFC) COLLATE "C"), id);
CREATE INDEX presentations_library_title_idx ON presentations(workspace_id, (normalize(lower(normalize(title, NFC) COLLATE "und-x-icu"), NFC) COLLATE "C"), id);
CREATE INDEX surveys_library_title_idx ON surveys(workspace_id, (normalize(lower(normalize((data->'draft'->>'title'), NFC) COLLATE "und-x-icu"), NFC) COLLATE "C"), id);
