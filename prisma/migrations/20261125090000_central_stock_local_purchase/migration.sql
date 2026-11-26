-- Central stock receipts bought from a local supplier.
--
-- A local purchase never crossed a border, so it has no T1 validation. The
-- receipt is otherwise the same record -- same depot, same item, same ledger,
-- same clearances -- so it stays in `CentralStock` and `t1ValidationId`
-- becomes nullable instead of a second table being introduced.
--
-- Every step is guarded against being applied twice and none of them rewrites
-- a row: this runs against a live database.
--
--   1. `t1ValidationId` relaxed to NULL. Every existing receipt has one, so
--      nothing already on record becomes invalid. The foreign key is left
--      exactly as it is -- MODIFY on the column does not touch it.
--   2. `unitPrice`, `currencyCode` and `truckNumber` added, all NULL, which
--      is what every existing (imported) receipt should carry.

-- 1. The T1 becomes optional.
SET @nullable := (
  SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'CentralStock'
    AND COLUMN_NAME = 't1ValidationId'
);
SET @sql := IF(
  @nullable = 'NO',
  'ALTER TABLE `CentralStock` MODIFY `t1ValidationId` VARCHAR(191) NULL',
  'SELECT "t1ValidationId is already nullable" AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. What a local purchase cost, and what brought it in.
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock'
     AND COLUMN_NAME = 'unitPrice') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `unitPrice` DECIMAL(18, 2) NULL',
  'SELECT "unitPrice exists" AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock'
     AND COLUMN_NAME = 'currencyCode') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `currencyCode` VARCHAR(191) NULL',
  'SELECT "currencyCode exists" AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStock'
     AND COLUMN_NAME = 'truckNumber') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `truckNumber` VARCHAR(191) NULL',
  'SELECT "truckNumber exists" AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
