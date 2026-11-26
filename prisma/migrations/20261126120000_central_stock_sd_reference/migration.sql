-- The supplier's own reference for a local delivery.
--
-- Added nullable, so every receipt already on record stays valid: an import
-- has none by definition, and the local purchases recorded before this column
-- existed have nothing to recover it from.
--
-- Guarded rather than plain `ADD COLUMN`: MySQL has no transactional DDL, so a
-- migration that is half-applied has to be safe to run again. `INFORMATION_SCHEMA`
-- is checked first and the statement is only prepared when the column is
-- genuinely missing.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CentralStock'
      AND COLUMN_NAME = 'sdReference') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `sdReference` VARCHAR(191) NULL',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
