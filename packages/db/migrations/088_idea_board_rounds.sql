-- Retained workshops may open a fresh round without changing identity or hard retention.
ALTER TABLE idea_boards ADD CONSTRAINT idea_board_round_bounds CHECK (
  coalesce((data->>'roundNumber')::integer,1) BETWEEN 1 AND 20
  AND jsonb_array_length(coalesce(data->'roundHistory','[]'::jsonb)) <= 19
);

CREATE OR REPLACE FUNCTION preserve_idea_board_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_round integer := coalesce((OLD.data->>'roundNumber')::integer,1);
  new_round integer := coalesce((NEW.data->>'roundNumber')::integer,1);
  old_history jsonb := coalesce(OLD.data->'roundHistory','[]'::jsonb);
  new_history jsonb := coalesce(NEW.data->'roundHistory','[]'::jsonb);
  reopening boolean;
BEGIN
  reopening := new_round=old_round+1 AND new_round<=20
    AND (OLD.data->>'status'='closed' OR (OLD.data->>'closesAt')::timestamptz<=clock_timestamp())
    AND NEW.data->>'status'='collecting'
    AND (NEW.data->>'closesAt')::timestamptz>clock_timestamp()
    AND (NEW.data->>'closesAt')::timestamptz<=(OLD.data->>'expiresAt')::timestamptz
    AND jsonb_array_length(new_history)=jsonb_array_length(old_history)+1
    AND (new_history-(jsonb_array_length(new_history)-1))=old_history
    AND (new_history->-1->>'roundNumber')::integer=old_round
    AND (NEW.data->>'revision')::bigint=(OLD.data->>'revision')::bigint+1
    AND NEW.data->'closedAt'='null'::jsonb;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.creation_key<>OLD.creation_key OR NEW.retention_expires_at<>OLD.retention_expires_at
    OR NEW.data->'identityMode' IS DISTINCT FROM OLD.data->'identityMode'
    OR NEW.data->'expiresAt' IS DISTINCT FROM OLD.data->'expiresAt'
    OR NEW.data->'participantLimit' IS DISTINCT FROM OLD.data->'participantLimit'
    OR NEW.data->'voteBudget' IS DISTINCT FROM OLD.data->'voteBudget'
    OR NEW.data->'moderationEnabled' IS DISTINCT FROM OLD.data->'moderationEnabled'
    OR (NOT coalesce(reopening,false) AND (NEW.data->'closesAt' IS DISTINCT FROM OLD.data->'closesAt' OR new_round<>old_round OR new_history<>old_history)) THEN
    RAISE EXCEPTION 'Idea board identity, limits and retention are immutable' USING ERRCODE='23514';
  END IF;
  IF reopening THEN
    IF (NEW.data-ARRAY['status','closesAt','roundNumber','roundHistory','closedAt','revision','guests','receipts'])
      IS DISTINCT FROM (OLD.data-ARRAY['status','closesAt','roundNumber','roundHistory','closedAt','revision','guests','receipts'])
      OR jsonb_array_length(NEW.data->'receipts')<>jsonb_array_length(OLD.data->'receipts')+1
      OR ((NEW.data->'receipts')-(jsonb_array_length(NEW.data->'receipts')-1)) IS DISTINCT FROM OLD.data->'receipts'
      OR jsonb_array_length(NEW.data->'guests')<>jsonb_array_length(OLD.data->'guests')
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(OLD.data->'guests') WITH ORDINALITY old_guest(value,position)
        JOIN jsonb_array_elements(NEW.data->'guests') WITH ORDINALITY new_guest(value,position) USING(position)
        WHERE (old_guest.value-ARRAY['revision','votedIdeaIds','votedRound']) IS DISTINCT FROM (new_guest.value-ARRAY['revision','votedIdeaIds','votedRound'])
          OR (new_guest.value->>'revision')::bigint<>(old_guest.value->>'revision')::bigint+1
          OR new_guest.value->'votedIdeaIds' IS DISTINCT FROM '[]'::jsonb
          OR new_guest.value->>'votedRound' IS DISTINCT FROM '0'
      ) THEN
      RAISE EXCEPTION 'Reopening preserves intake, credentials, receipts and resource limits' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.data->>'status'='closed' AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'Closed idea boards are immutable outside a bounded new round' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
