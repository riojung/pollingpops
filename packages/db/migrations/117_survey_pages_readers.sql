-- Deploy compatible readers before activating any future paged-Survey authoring grant.
-- Existing documents, frozen runs and exact mutation receipts remain unchanged.
ALTER TABLE surveys DROP CONSTRAINT surveys_data_check;
ALTER TABLE surveys ADD CONSTRAINT surveys_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2, 3));
ALTER TABLE survey_versions DROP CONSTRAINT survey_versions_data_check;
ALTER TABLE survey_versions ADD CONSTRAINT survey_versions_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2, 3));
ALTER TABLE survey_feedback_rooms DROP CONSTRAINT survey_feedback_rooms_data_check;
ALTER TABLE survey_feedback_rooms ADD CONSTRAINT survey_feedback_rooms_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2, 3));
ALTER TABLE survey_guests DROP CONSTRAINT survey_guests_data_check;
ALTER TABLE survey_guests ADD CONSTRAINT survey_guests_data_check
  CHECK ((data->>'schemaVersion')::integer IN (1, 2, 3));
