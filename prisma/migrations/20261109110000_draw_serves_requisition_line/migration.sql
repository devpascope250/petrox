-- The draw against a clearance records which requisition line it serves.
--
-- Nullable for good, not just for the backfill: a B2B sale is drawn against a
-- clearance with no requisition behind it, and the draws raised before
-- requisitions existed belong to no line either.
--
-- Written so it can be run again after a part-way failure.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStockOrder' AND COLUMN_NAME = 'requisitionLineId') = 0,
  'ALTER TABLE `CentralStockOrder` ADD COLUMN `requisitionLineId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStockOrder' AND INDEX_NAME = 'CentralStockOrder_requisitionLineId_idx') = 0,
  'CREATE INDEX `CentralStockOrder_requisitionLineId_idx` ON `CentralStockOrder`(`requisitionLineId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CentralStockOrder'
      AND CONSTRAINT_NAME = 'CentralStockOrder_requisitionLineId_fkey') = 0,
  'ALTER TABLE `CentralStockOrder` ADD CONSTRAINT `CentralStockOrder_requisitionLineId_fkey` FOREIGN KEY (`requisitionLineId`) REFERENCES `RequisitionLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
