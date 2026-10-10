-- Forward repair for room-creation receipts written before they had room-scoped cleanup.
-- Applied migration 061 remains unchanged. Do not alter the original acknowledgement body.
SELECT set_config('app.system_access', 'on', true);

UPDATE survey_mutation_receipts AS receipt
SET room_id = room.id
FROM survey_feedback_rooms AS room
WHERE receipt.room_id IS NULL
  AND receipt.receipt->>'identityPolicy' = 'organizer_blind'
  AND receipt.receipt->>'id' = room.id::text
  AND receipt.workspace_id = room.workspace_id
  AND receipt.survey_id = room.survey_id;

-- Receipts for already-deleted/expired rooms must not resurrect unusable sharing links.
DELETE FROM survey_mutation_receipts
WHERE room_id IS NULL AND receipt->>'identityPolicy' = 'organizer_blind';
