-- Optional, server-private credentials. Existing rooms remain open.
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS join_password_hash text;
ALTER TABLE presentation_live_sessions ADD COLUMN IF NOT EXISTS join_password_hash text;
ALTER TABLE survey_feedback_rooms ADD COLUMN IF NOT EXISTS join_password_hash text;
