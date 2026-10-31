-- Keep accepted V1/V2 receipt fingerprints; current writers upgrade metadata one way.
-- Canvas V3 adds bounded diagram shapes and connector styles, without changing admission limits.
ALTER TABLE canvas_boards DROP CONSTRAINT canvas_boards_schema_version_check;
ALTER TABLE canvas_boards ADD CONSTRAINT canvas_boards_schema_version_check
  CHECK(schema_version IN (1,2,3));
ALTER TABLE canvas_boards ALTER COLUMN schema_version SET DEFAULT 3;
-- preserve_canvas_schema_version from migration 080 still forbids a version downgrade.
