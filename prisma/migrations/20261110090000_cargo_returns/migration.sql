-- A shipment going back to the supplier, with or without a replacement.
--
-- Nothing is rewritten. The cargo keeps its quantities, references, PFIs and
-- invoices exactly as they were; `CargoReturn` says what went back, why, what
-- the supplier owes for it, and which shipment came instead. The position
-- before the return and after it are both readable from the records.
--
-- `returned` and `replaced` are **appended** to `CargoStatus`, never inserted:
-- MySQL stores an enum by index, so inserting a value would silently change
-- the meaning of every row already stored.
--
-- Purely additive: one new table, two new enum values, one new column. No
-- existing row changes. Written so it can be run again after a part-way
-- failure — MySQL has no transactional DDL, so each step checks for itself
-- whether it is still to do.

ALTER TABLE `Cargo`
  MODIFY `status` ENUM('pending', 'approved', 'cancelled', 'returned', 'replaced') NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS `CargoReturn` (
  `id` VARCHAR(191) NOT NULL,
  `cargoId` VARCHAR(191) NOT NULL,
  `kind` ENUM('returned', 'replaced') NOT NULL,
  `quantityInLitre` DECIMAL(18, 2) NOT NULL,
  `quantityInKg` DECIMAL(18, 2) NOT NULL,
  `reason` TEXT NOT NULL,
  `supportingDocUrl` VARCHAR(191) NULL,
  `refundAmount` DECIMAL(18, 2) NULL,
  `currencyCode` VARCHAR(191) NULL,
  `replacementCargoId` VARCHAR(191) NULL,
  `returnedBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `CargoReturn_replacementCargoId_key`(`replacementCargoId`),
  INDEX `CargoReturn_cargoId_idx`(`cargoId`),
  INDEX `CargoReturn_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CargoReturn'
      AND CONSTRAINT_NAME = 'CargoReturn_cargoId_fkey') = 0,
  'ALTER TABLE `CargoReturn` ADD CONSTRAINT `CargoReturn_cargoId_fkey` FOREIGN KEY (`cargoId`) REFERENCES `Cargo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CargoReturn'
      AND CONSTRAINT_NAME = 'CargoReturn_replacementCargoId_fkey') = 0,
  'ALTER TABLE `CargoReturn` ADD CONSTRAINT `CargoReturn_replacementCargoId_fkey` FOREIGN KEY (`replacementCargoId`) REFERENCES `Cargo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CargoReturn'
      AND CONSTRAINT_NAME = 'CargoReturn_returnedBy_fkey') = 0,
  'ALTER TABLE `CargoReturn` ADD CONSTRAINT `CargoReturn_returnedBy_fkey` FOREIGN KEY (`returnedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
