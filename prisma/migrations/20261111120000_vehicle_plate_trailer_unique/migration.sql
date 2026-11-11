-- A rig is the plate **and** the trailer together.
--
-- One tractor unit is coupled to different trailers over its life, and each
-- pairing is a different thing to nominate — its own tank, its own capacity,
-- its own paperwork. So the same plate may be recorded more than once as long
-- as the trailer differs, and the pair may not repeat.
--
-- There was no uniqueness on this table at all before: a duplicate plate was
-- refused only by the spreadsheet importer, so two identical trucks could be
-- entered through the form. This is the first constraint the database itself
-- holds.
--
-- `trailerNumber` is NOT NULL, which is what makes a composite unique work
-- here: MySQL treats two NULLs as different, so a nullable column would let
-- the same plate in without limit.
--
-- **If this step fails** with a duplicate-entry error, the table already holds
-- two rows that this index would forbid. Nothing has been changed; find them
-- with
--
--   SELECT platNumber, trailerNumber, COUNT(*) n FROM Vehicle
--   GROUP BY platNumber, trailerNumber HAVING n > 1;
--
-- decide which row is the real rig, and move the other's assignments to it
-- before running this again. The migration deliberately does not choose for
-- you: a truck is not something to merge by guesswork.
--
-- Written so it can be run again after a part-way failure — MySQL has no
-- transactional DDL, so the step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Vehicle'
      AND INDEX_NAME = 'Vehicle_platNumber_trailerNumber_key') = 0,
  'CREATE UNIQUE INDEX `Vehicle_platNumber_trailerNumber_key` ON `Vehicle`(`platNumber`, `trailerNumber`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
