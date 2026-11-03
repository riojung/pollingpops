-- Native Presentation v4 image nodes participate in the existing tenant-scoped retention graph.
-- Keep legacy block/question assets and frozen Pack originals/update baselines. Existing
-- reference-acquisition/deletion locks and forced-RLS draft/version/history triggers stay active.
CREATE OR REPLACE FUNCTION openround_presentation_media_ids(document jsonb)
RETURNS TABLE(media_id uuid) LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT candidate.media_id
  FROM (
    SELECT block_media.media_id::uuid
    FROM (
      SELECT CASE
        WHEN block->>'kind' = 'content' THEN block->>'mediaId'
        ELSE block->'question'->>'mediaId'
      END AS media_id
      FROM jsonb_array_elements(COALESCE(document->'blocks', '[]'::jsonb)) AS block
    ) AS block_media
    WHERE block_media.media_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    UNION ALL
    SELECT (node->>'mediaId')::uuid AS media_id
    FROM jsonb_array_elements(COALESCE(document->'blocks', '[]'::jsonb)) AS block
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(block->'scene'->'nodes', '[]'::jsonb)) AS node
    WHERE block->>'kind' = 'content' AND node->>'type' = 'image'
      AND node->>'mediaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    UNION ALL
    SELECT reference.media_id
    FROM jsonb_array_elements(COALESCE(document->'recoveryPackInsertions', '[]'::jsonb)) AS insertion
    CROSS JOIN LATERAL openround_recovery_pack_media_ids(insertion->'originalContent') AS reference
    UNION ALL
    SELECT reference.media_id
    FROM jsonb_array_elements(COALESCE(document->'recoveryPackInsertions', '[]'::jsonb)) AS insertion
    CROSS JOIN LATERAL openround_recovery_pack_media_ids(insertion->'updateBaseline'->'content') AS reference
  ) AS candidate
$$;

-- Add newly discovered edges without changing immutable documents or removing old references.
-- The transaction-local system setting permits maintenance under forced RLS for non-superusers.
SELECT set_config('app.system_access', 'on', true);
INSERT INTO media_references (workspace_id, media_id, owner_type, owner_id)
SELECT documents.workspace_id, asset.id, documents.owner_type, documents.owner_id
FROM (
  SELECT workspace_id, id AS owner_id, 'presentation_draft'::text AS owner_type, draft AS document
  FROM presentations
  UNION ALL
  SELECT workspace_id, id, 'presentation_version', content FROM presentation_versions
  UNION ALL
  SELECT workspace_id, id, 'presentation_history', draft FROM presentation_draft_history
) AS documents
CROSS JOIN LATERAL openround_presentation_media_ids(documents.document) AS requested
JOIN media_assets asset
  ON asset.workspace_id = documents.workspace_id AND asset.id = requested.media_id
WHERE asset.scan_status <> 'deleting'
ON CONFLICT DO NOTHING;
