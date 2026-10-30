-- A rota row's nozzles go with it.
--
-- `TblPumpAttendant` now cascades from the roster row, so taking someone off a
-- day removes their pump assignment for it. The nozzles hanging off that
-- assignment did not cascade, so the database refused the delete instead:
-- un-rostering anybody who held a pump failed with a foreign key error.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantNozzle'
      AND CONSTRAINT_NAME = 'PumpAttendantNozzle_pumpAttendantId_fkey'
      AND DELETE_RULE <> 'CASCADE') > 0,
  'ALTER TABLE `PumpAttendantNozzle` DROP FOREIGN KEY `PumpAttendantNozzle_pumpAttendantId_fkey`',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantNozzle'
      AND CONSTRAINT_NAME = 'PumpAttendantNozzle_pumpAttendantId_fkey') = 0,
  'ALTER TABLE `PumpAttendantNozzle` ADD CONSTRAINT `PumpAttendantNozzle_pumpAttendantId_fkey`
     FOREIGN KEY (`pumpAttendantId`) REFERENCES `TblPumpAttendant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
