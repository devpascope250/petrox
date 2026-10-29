-- The subsidy a sale earned, recorded on the sale itself.
--
-- A subsidy is **a fixed amount towards each unit sold** — 240 a litre — never
-- a percentage, and it is **recorded, not deducted**: the customer still pays
-- what the pump showed. `subsidyRate` and `subsidyAmount` are the sale's own
-- figures, snapshots of the subsidy at the moment it was priced, so editing or
-- retiring a subsidy later cannot rewrite what a sale earned. `subsidyId` only
-- traces it back, and is cleared rather than blocking a delete.
--
-- A sale earns one only when it was for a client's car that is flagged
-- `subsidyAllowed` and takes the product being pumped. `ClientCar
-- .subsidyAllowed` is already in place.
--
-- Every column defaults to zero, so every sale already recorded reads as
-- earning nothing, which is what it did.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

-- FuelSale.subsidyId / subsidyRate / subsidyAmount
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelSale' AND COLUMN_NAME = 'subsidyId') = 0,
  'ALTER TABLE `FuelSale`
     ADD COLUMN `subsidyId` VARCHAR(191) NULL,
     ADD COLUMN `subsidyRate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
     ADD COLUMN `subsidyAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelSale' AND INDEX_NAME = 'FuelSale_subsidyId_idx') = 0,
  'CREATE INDEX `FuelSale_subsidyId_idx` ON `FuelSale`(`subsidyId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelSale' AND CONSTRAINT_NAME = 'FuelSale_subsidyId_fkey') = 0,
  'ALTER TABLE `FuelSale`
     ADD CONSTRAINT `FuelSale_subsidyId_fkey` FOREIGN KEY (`subsidyId`)
     REFERENCES `Subsidy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- GeneralTransaction.subsidyId — the rate and the amount are already there.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'GeneralTransaction' AND COLUMN_NAME = 'subsidyId') = 0,
  'ALTER TABLE `GeneralTransaction` ADD COLUMN `subsidyId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'GeneralTransaction' AND INDEX_NAME = 'GeneralTransaction_subsidyId_idx') = 0,
  'CREATE INDEX `GeneralTransaction_subsidyId_idx` ON `GeneralTransaction`(`subsidyId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'GeneralTransaction' AND CONSTRAINT_NAME = 'GeneralTransaction_subsidyId_fkey') = 0,
  'ALTER TABLE `GeneralTransaction`
     ADD CONSTRAINT `GeneralTransaction_subsidyId_fkey` FOREIGN KEY (`subsidyId`)
     REFERENCES `Subsidy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- ClientCar.subsidyAllowed — added to the schema by hand, so a database that
-- has not seen it yet gets it here.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClientCar' AND COLUMN_NAME = 'subsidyAllowed') = 0,
  'ALTER TABLE `ClientCar` ADD COLUMN `subsidyAllowed` BOOLEAN NOT NULL DEFAULT false',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
