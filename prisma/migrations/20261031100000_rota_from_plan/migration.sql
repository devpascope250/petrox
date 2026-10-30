-- Which pump assignments a weekday plan wrote.
--
-- Without this, "apply this plan to the days already rostered" could only add:
-- moving a plan from PUMP1 to PUMP2 left the day carrying both. The stamp says
-- which row the plan itself owns, so applying it again changes that row rather
-- than adding beside it.
--
-- It is cleared the moment somebody changes a day by hand — from then on the
-- day is theirs and the plan leaves it alone — and cleared if the plan is
-- deleted, because the day was still worked.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant' AND COLUMN_NAME = 'fromPlanId') = 0,
  'ALTER TABLE `TblPumpAttendant` ADD COLUMN `fromPlanId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND INDEX_NAME = 'TblPumpAttendant_fromPlanId_idx') = 0,
  'CREATE INDEX `TblPumpAttendant_fromPlanId_idx` ON `TblPumpAttendant`(`fromPlanId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'
      AND CONSTRAINT_NAME = 'TblPumpAttendant_fromPlanId_fkey') = 0,
  'ALTER TABLE `TblPumpAttendant` ADD CONSTRAINT `TblPumpAttendant_fromPlanId_fkey`
     FOREIGN KEY (`fromPlanId`) REFERENCES `PumpAttendantPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
