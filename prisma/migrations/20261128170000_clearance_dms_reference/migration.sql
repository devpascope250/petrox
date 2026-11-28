-- The DMS number of the declaration a clearance was filed under.
--
-- Nullable and never backfilled: every clearance already on this database was
-- raised before the number was asked for, and NULL says exactly that — nobody
-- wrote it down — rather than inventing a figure customs never issued.
--
-- Guarded both ways so re-running is harmless: MySQL has no transactional DDL,
-- so a half-applied migration cannot be rolled back.

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ClearanceRequest'
      AND COLUMN_NAME = 'dmsReference') = 0,
  'ALTER TABLE `ClearanceRequest` ADD COLUMN `dmsReference` VARCHAR(191) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'StockClearance'
      AND COLUMN_NAME = 'dmsReference') = 0,
  'ALTER TABLE `StockClearance` ADD COLUMN `dmsReference` VARCHAR(191) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
