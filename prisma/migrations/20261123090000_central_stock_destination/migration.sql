-- Where a received load was **sent**, beside where it was discharged.
--
-- `CentralStock.deportId` is the depot the fuel actually went into.
-- `destinationId` is the depot the trip was dispatched to, chosen from the
-- same list. Both are kept because they are not always the same: a load
-- diverted en route can only be seen when the row carries each end of it.
-- `Nomination.destination` is free text typed when the trip was raised and may
-- name a town rather than a depot, so it cannot stand in for this.
--
-- Nullable and NULL for every row already on record: the destination of a past
-- receipt cannot be recovered, and copying `deportId` into it would state as
-- fact that nothing was ever diverted.
--
-- Additive: one nullable column, its index, and a foreign key that no existing
-- row can violate because every one of them is NULL. Nothing is rewritten and
-- no existing column is touched.
--
-- Re-runnable after a part-way failure: MySQL has no transactional DDL, so
-- each step checks INFORMATION_SCHEMA for itself before doing anything.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock' AND COLUMN_NAME = 'destinationId') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `destinationId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock' AND INDEX_NAME = 'CentralStock_destinationId_idx') = 0,
  'CREATE INDEX `CentralStock_destinationId_idx` ON `CentralStock`(`destinationId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- ON DELETE SET NULL, not CASCADE: a depot being removed from the list must
-- never take receipts of fuel with it.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock'
      AND CONSTRAINT_NAME = 'CentralStock_destinationId_fkey') = 0,
  'ALTER TABLE `CentralStock` ADD CONSTRAINT `CentralStock_destinationId_fkey` FOREIGN KEY (`destinationId`) REFERENCES `Deport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
