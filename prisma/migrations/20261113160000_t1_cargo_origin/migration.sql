-- Where a T1's fuel came from, as a reference.
--
-- `T1Validation.cargoId` names the shipment the load is said to have come off.
-- It is a **reference and nothing more**: the litres a trip takes are still
-- drawn from the batches its nomination names, and `quantityAt20C` is still
-- apportioned across those. Its purpose is to tell a T1 whose fuel came off
-- the cargo the nomination drew on from one that came off a different cargo,
-- which until now could only be guessed at.
--
-- Nullable, and every row already on record keeps NULL: the origin is not
-- always known when a T1 is entered, and nothing can be inferred for the past
-- without inventing it.
--
-- Purely additive. Written so it can be run again after a part-way failure:
-- MySQL has no transactional DDL, so each step checks for itself whether it is
-- still to do. The foreign key goes last, after the column and its index.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation' AND COLUMN_NAME = 'cargoId') = 0,
  'ALTER TABLE `T1Validation` ADD COLUMN `cargoId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation'
      AND INDEX_NAME = 'T1Validation_cargoId_idx') = 0,
  'CREATE INDEX `T1Validation_cargoId_idx` ON `T1Validation`(`cargoId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- ON DELETE SET NULL: a shipment that goes away takes its reference with it
-- and leaves the T1 standing. The T1 is the customs record of what a truck
-- took; it does not stop being true because the pointer to its origin did.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'T1Validation'
      AND CONSTRAINT_NAME = 'T1Validation_cargoId_fkey') = 0,
  'ALTER TABLE `T1Validation` ADD CONSTRAINT `T1Validation_cargoId_fkey` FOREIGN KEY (`cargoId`) REFERENCES `Cargo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
