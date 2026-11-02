-- Canvas V4 adds bounded manual styles and variants without changing retained limits.
-- Keep legacy creation/operation fingerprints and prohibit downgrades as before.
ALTER TABLE canvas_boards DROP CONSTRAINT canvas_boards_schema_version_check;
ALTER TABLE canvas_boards ADD CONSTRAINT canvas_boards_schema_version_check
  CHECK(schema_version IN (1,2,3,4));
ALTER TABLE canvas_boards ALTER COLUMN schema_version SET DEFAULT 4;
