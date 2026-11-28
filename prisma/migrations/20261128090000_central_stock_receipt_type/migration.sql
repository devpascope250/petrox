-- How a receipt came about: an import, or one of the three local kinds.
--
-- Added NULL-able with no default. A default of 'import' would have been
-- written onto the local purchases already on record, making the column
-- contradict the `t1ValidationId` it is tied to; there is nothing in those
-- rows to recover the real answer from, so they stay NULL, meaning "recorded
-- before this was asked". Nothing is backfilled and no existing row is
-- rewritten.
--
-- Guarded rather than plain DDL: MySQL has no transactional DDL, so a
-- half-applied migration has to be safe to run again. Both steps check
-- INFORMATION_SCHEMA first and only prepare a statement when there is
-- genuinely something to do.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CentralStock'
      AND COLUMN_NAME = 'receiptType') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `receiptType` ENUM(''import'', ''gain'', ''transfer'', ''borrow'') NULL',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- The reports filter on it, as they do on `status`.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CentralStock'
      AND INDEX_NAME = 'CentralStock_receiptType_idx') = 0,
  'CREATE INDEX `CentralStock_receiptType_idx` ON `CentralStock`(`receiptType`)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
