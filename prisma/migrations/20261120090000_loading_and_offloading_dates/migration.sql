-- When the fuel actually moved, at both ends of the trip.
--
-- `T1Validation.loadingDate` is the day the truck was loaded, as the transit
-- document states it. `CentralStock.offloadingDate` is the day it was
-- discharged into the depot. Neither can be read off `createdAt`: both rows
-- are keyed in when the paperwork reaches the office, which is routinely days
-- after the event they describe — so the two dates together are what say how
-- long a load was on the road, and `createdAt` says only when somebody typed.
--
-- `Nomination.expectedLoadingDate` is the plan; `loadingDate` is what happened.
--
-- Both NULL and nullable, so every row already on record is untouched: there
-- is no way to recover these dates for the past, and defaulting them to
-- `createdAt` would state as fact a date nobody recorded.
--
-- Purely additive — two columns, no index, no constraint, nothing rewritten.
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation' AND COLUMN_NAME = 'loadingDate') = 0,
  'ALTER TABLE `T1Validation` ADD COLUMN `loadingDate` DATETIME(3) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock' AND COLUMN_NAME = 'offloadingDate') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `offloadingDate` DATETIME(3) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
