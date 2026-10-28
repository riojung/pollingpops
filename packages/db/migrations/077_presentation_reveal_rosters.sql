-- Freeze the published roster under the transition's session lock. joined_at is allocated
-- before admission and cannot reliably distinguish participants admitted after a reveal.
-- Legacy rows stay null: reconstructing their roster would invent historical membership.
ALTER TABLE presentation_session_timeline
  ADD COLUMN IF NOT EXISTS revealed_participant_ids uuid[];
