-- A pump assignment belongs to a rostered **day**, not to a shift for ever.
--
-- The forecourt rotates: the same attendant is on another pump next week. A
-- rota row with no date could not say that, and worse, it was read as it stood
-- *now* even for a day in the past — so recording last week's meter readings
-- after a rotation offered this week's pumps and refused the nozzle that was
-- genuinely theirs.
--
-- So the rota now hangs off the roster row (`TblTimeTable`), which already
-- says who, which shift, which site and which day. One place for all of it:
-- the two can never disagree, a pump cannot be given to someone who is not
-- rostered, and taking someone off a day takes their pump with it
-- (ON DELETE CASCADE).
--
-- **This is the first of two migrations.** It only adds the link, nullable, so
-- every existing row survives and the POS keeps confirming sales. Then:
--
--     pnpm rota:dates            # what it would write
--     pnpm rota:dates --apply    # writes the dated rows, from today forward
--     npx prisma migrate deploy  # the second migration finishes the job
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant' AND COLUMN_NAME = 'timeTableId') = 0,
  'ALTER TABLE `TblPumpAttendant` ADD COLUMN `timeTableId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_timeTableId_idx') = 0,
  'CREATE INDEX `TblPumpAttendant_timeTableId_idx` ON `TblPumpAttendant`(`timeTableId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- Cascade: a roster row removed takes its pump assignments with it, because a
-- pump assignment for a day someone is not rostered on means nothing.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND CONSTRAINT_NAME = 'TblPumpAttendant_timeTableId_fkey') = 0,
  'ALTER TABLE `TblPumpAttendant` ADD CONSTRAINT `TblPumpAttendant_timeTableId_fkey`
     FOREIGN KEY (`timeTableId`) REFERENCES `TblTimeTable`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- The old key allowed one row per attendant, shift and pump for all time. A
-- dated rota needs one per day, so it goes now rather than after the back-fill,
-- which would otherwise collide with itself on the second day it writes.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_userId_siteShiftId_pumpId_key') > 0,
  'ALTER TABLE `TblPumpAttendant` DROP INDEX `TblPumpAttendant_userId_siteShiftId_pumpId_key`',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
