-- Finishes dating the pump rota: the link becomes required and the copies go.
--
-- The second of two migrations. `20261030160000_pump_rota_by_day` added
-- `timeTableId` as nullable; `pnpm rota:dates --apply` writes it out. Only then
-- can the link be required and the duplicated columns dropped.
--
-- `userId`, `siteShiftId` and `siteId` were copies of what the roster row
-- already says. A roster row can be edited — moved to another person, shift or
-- day — so the copies could come to disagree with it, and whichever one some
-- query happened to read would decide what the rota meant. They go, and
-- everything reads the roster row through `timeTableId`.
--
-- If any row is still undated this **stops with an error** rather than
-- dropping the columns and taking those assignments with them:
--
--     pnpm rota:dates                     # what is left, and why
--     pnpm rota:dates --apply             # write the ones that can be written
--     pnpm rota:dates --discard-unplaced  # drop the ones no roster day covers
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

-- The guard. There is no `SIGNAL` to be had here — it cannot be prepared, and a
-- stored procedure's body would need a delimiter this runner does not give us —
-- so the stop is a column that does not exist, named after what to do. MySQL
-- answers `Unknown column 'run pnpm rota:dates --apply first: a rota row has no
-- day' in 'field list'`, and nothing below it runs.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant' AND COLUMN_NAME = 'timeTableId') = 0,
  'SELECT 1',
  IF((SELECT COUNT(*) FROM `TblPumpAttendant` WHERE `timeTableId` IS NULL) = 0,
    'SELECT 1',
    'SELECT `run pnpm rota:dates --apply first: a rota row has no day`'));
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Required from here: a pump assignment with no rostered day means nothing.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND COLUMN_NAME = 'timeTableId' AND IS_NULLABLE = 'YES') > 0,
  'ALTER TABLE `TblPumpAttendant` MODIFY COLUMN `timeTableId` VARCHAR(191) NOT NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- One row per pump per rostered day.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_timeTableId_pumpId_key') = 0,
  'ALTER TABLE `TblPumpAttendant` ADD UNIQUE INDEX `TblPumpAttendant_timeTableId_pumpId_key` (`timeTableId`, `pumpId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- The copies: their foreign keys first, then their indexes, then the columns.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND CONSTRAINT_NAME = 'TblPumpAttendant_userId_fkey') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP FOREIGN KEY `TblPumpAttendant_userId_fkey`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND CONSTRAINT_NAME = 'TblPumpAttendant_siteShiftId_fkey') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP FOREIGN KEY `TblPumpAttendant_siteShiftId_fkey`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND CONSTRAINT_NAME = 'TblPumpAttendant_siteId_fkey') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP FOREIGN KEY `TblPumpAttendant_siteId_fkey`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_userId_idx') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP INDEX `TblPumpAttendant_userId_idx`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_siteShiftId_idx') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP INDEX `TblPumpAttendant_siteShiftId_idx`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_siteId_idx') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP INDEX `TblPumpAttendant_siteId_idx`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant' AND COLUMN_NAME = 'userId') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP COLUMN `userId`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant' AND COLUMN_NAME = 'siteShiftId') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP COLUMN `siteShiftId`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant' AND COLUMN_NAME = 'siteId') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP COLUMN `siteId`', 'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
