-- Store the count with the report so history analytics can aggregate it without
-- reading the report payload. PostgreSQL computes it for existing and future rows.
-- Keep malformed historical values null and use JavaScript's maximum safe integer.
ALTER TABLE reports
  ADD COLUMN participant_count bigint GENERATED ALWAYS AS (
    CASE
      WHEN status = 'ready'
        AND jsonb_typeof(metrics #> '{metrics,participantCount}') = 'number'
      THEN
        CASE
          WHEN (metrics #> '{metrics,participantCount}')::numeric BETWEEN 0 AND 9007199254740991
            AND trunc((metrics #> '{metrics,participantCount}')::numeric)
              = (metrics #> '{metrics,participantCount}')::numeric
          THEN (metrics #> '{metrics,participantCount}')::bigint
        END
    END
  ) STORED;
