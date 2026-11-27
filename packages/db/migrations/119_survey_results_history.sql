CREATE INDEX IF NOT EXISTS survey_feedback_rooms_workspace_deadline_cursor_idx
  ON survey_feedback_rooms (workspace_id, closes_at DESC, id ASC);
