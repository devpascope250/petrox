-- Whose shift a meter reading is for.
--
-- A reading is recorded against the attendant the **time table** puts on that
-- shift that day, on a pump and a nozzle the **rota** gives them — the same
-- three facts the POS checks before it lets them confirm a sale. That is what
-- lets the meter and the sales be read against each other: litres through the
-- nozzle on one side, what was rung up on the other, the same person on both.
--
-- `NOT NULL` with no default, on purpose: there is no way to record a reading
-- without an attendant, so there is no figure to default to. The column is
-- added to a table that is empty everywhere — the readings only start with
-- this release — so nothing has to be back-filled. Were a reading ever to be
-- allowed without one, this becomes a one-line `MODIFY ... NULL`.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex' AND COLUMN_NAME = 'attendantId') = 0,
  'ALTER TABLE `PumpIndex` ADD COLUMN `attendantId` VARCHAR(191) NOT NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND INDEX_NAME = 'PumpIndex_attendantId_idx') = 0,
  'CREATE INDEX `PumpIndex_attendantId_idx` ON `PumpIndex`(`attendantId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_attendantId_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_attendantId_fkey`
     FOREIGN KEY (`attendantId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
