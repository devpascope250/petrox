-- Who a local receipt's fuel came from.
--
-- Nullable with no default and no backfill: a `gain` has nobody it came from,
-- and the receipts already on record cannot have a supplier invented for them.
-- No existing row is rewritten.
--
-- `ON DELETE RESTRICT` rather than the `SET NULL` Prisma defaults optional
-- relations to: a supplier that has delivered stock must not be deletable, and
-- silently forgetting who delivered a load is worse than refusing the delete.
--
-- Every step is guarded. MySQL has no transactional DDL, so a half-applied
-- migration has to be safe to run again; each statement is only prepared when
-- INFORMATION_SCHEMA says there is something to do.
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CentralStock'
      AND COLUMN_NAME = 'supplierId') = 0,
  'ALTER TABLE `CentralStock` ADD COLUMN `supplierId` VARCHAR(191) NULL',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CentralStock'
      AND INDEX_NAME = 'CentralStock_supplierId_idx') = 0,
  'CREATE INDEX `CentralStock_supplierId_idx` ON `CentralStock`(`supplierId`)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CentralStock'
      AND CONSTRAINT_NAME = 'CentralStock_supplierId_fkey') = 0,
  'ALTER TABLE `CentralStock` ADD CONSTRAINT `CentralStock_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
