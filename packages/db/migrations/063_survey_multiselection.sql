-- Expand readers before enabling v2 writers. Keep v1 immutable snapshots and accepted data.
-- Previous binaries cannot read v2 Surveys; rollback must keep compatible readers deployed.
ALTER TABLE surveys DROP CONSTRAINT surveys_data_check;
ALTER TABLE surveys ADD CONSTRAINT surveys_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2));
ALTER TABLE survey_versions DROP CONSTRAINT survey_versions_data_check;
ALTER TABLE survey_versions ADD CONSTRAINT survey_versions_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2));
ALTER TABLE survey_feedback_rooms DROP CONSTRAINT survey_feedback_rooms_data_check;
ALTER TABLE survey_feedback_rooms ADD CONSTRAINT survey_feedback_rooms_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2));
ALTER TABLE survey_guests DROP CONSTRAINT survey_guests_data_check;
ALTER TABLE survey_guests ADD CONSTRAINT survey_guests_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2));
