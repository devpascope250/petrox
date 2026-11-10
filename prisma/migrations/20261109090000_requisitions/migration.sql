-- Requisitions: a station's ask, its lines, and the rungs it climbed.
--
-- The ask carries nothing about supply — no clearance, no central stock batch,
-- no price. Which cleared batch the fuel comes from is decided when a load is
-- built, and the stock is committed only then, so an accepted requisition is
-- permission rather than a reservation.
--
-- `StockTransaction.drawId` is the other half of this step and matters on its
-- own: a movement could previously only be found by `centralStockId` and
-- `type`, which matches every withdrawal from the same batch — so an edit that
-- meant to correct one order's movement rewrote them all. It is nullable
-- because the movements written before today cannot all be attributed, and a
-- reconciliation has no draw behind it.
--
-- Purely additive: nothing is dropped, no existing row changes, and no code
-- reads these tables yet. The existing `CentralStockOrder` rows are untouched
-- and are regrouped into requisitions by a separate, reviewable backfill.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockTransaction' AND COLUMN_NAME = 'drawId') = 0,
  'ALTER TABLE `StockTransaction` ADD COLUMN `drawId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockTransaction' AND INDEX_NAME = 'StockTransaction_drawId_idx') = 0,
  'CREATE INDEX `StockTransaction_drawId_idx` ON `StockTransaction`(`drawId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockTransaction'
      AND CONSTRAINT_NAME = 'StockTransaction_drawId_fkey') = 0,
  'ALTER TABLE `StockTransaction` ADD CONSTRAINT `StockTransaction_drawId_fkey` FOREIGN KEY (`drawId`) REFERENCES `CentralStockOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

CREATE TABLE IF NOT EXISTS `Requisition` (
    `id` VARCHAR(191) NOT NULL,
    `requisitionNo` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `step` ENUM('submitted', 'accepted', 'loading', 'delivered', 'changeRequested', 'rejected', 'cancelled') NOT NULL DEFAULT 'submitted',
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Requisition_requisitionNo_key`(`requisitionNo`),
    INDEX `Requisition_siteId_step_idx`(`siteId`, `step`),
    INDEX `Requisition_step_createdAt_idx`(`step`, `createdAt`),
    INDEX `Requisition_requestedBy_idx`(`requestedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequisitionLine` (
    `id` VARCHAR(191) NOT NULL,
    `requisitionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `approvedQuantity` DECIMAL(18, 2) NULL,
    `loadedQuantity` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `receivedQuantity` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RequisitionLine_requisitionId_idx`(`requisitionId`),
    INDEX `RequisitionLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequisitionTimeline` (
    `id` VARCHAR(191) NOT NULL,
    `requisitionId` VARCHAR(191) NOT NULL,
    `step` ENUM('submitted', 'accepted', 'loading', 'delivered', 'changeRequested', 'rejected', 'cancelled') NOT NULL,
    `changedBy` VARCHAR(191) NULL,
    `comment` TEXT NULL,
    `fromQuantity` DECIMAL(18, 2) NULL,
    `toQuantity` DECIMAL(18, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequisitionTimeline_requisitionId_createdAt_idx`(`requisitionId`, `createdAt`),
    INDEX `RequisitionTimeline_changedBy_idx`(`changedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequisitionStep` (
    `id` VARCHAR(191) NOT NULL,
    `step` ENUM('submitted', 'accepted', 'loading', 'delivered', 'changeRequested', 'rejected', 'cancelled') NOT NULL,
    `level` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RequisitionStep_step_key`(`step`),
    INDEX `RequisitionStep_step_idx`(`step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Gap-free document numbers. A counter row, incremented inside the transaction
-- that creates the document, so two requests cannot both read the same maximum
-- and write the same number.
CREATE TABLE IF NOT EXISTS `NumberSequence` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NumberSequence_name_period_key`(`name`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys last, so a part-way run leaves no half-constrained table.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Requisition' AND CONSTRAINT_NAME = 'Requisition_siteId_fkey') = 0,
  'ALTER TABLE `Requisition` ADD CONSTRAINT `Requisition_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Requisition' AND CONSTRAINT_NAME = 'Requisition_requestedBy_fkey') = 0,
  'ALTER TABLE `Requisition` ADD CONSTRAINT `Requisition_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Requisition' AND CONSTRAINT_NAME = 'Requisition_decidedBy_fkey') = 0,
  'ALTER TABLE `Requisition` ADD CONSTRAINT `Requisition_decidedBy_fkey` FOREIGN KEY (`decidedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- A line dies with its requisition: it is part of the ask, not a record of
-- its own. The draws a line produced are never deleted, so nothing committed
-- can be lost this way.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RequisitionLine' AND CONSTRAINT_NAME = 'RequisitionLine_requisitionId_fkey') = 0,
  'ALTER TABLE `RequisitionLine` ADD CONSTRAINT `RequisitionLine_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `Requisition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RequisitionLine' AND CONSTRAINT_NAME = 'RequisitionLine_itemId_fkey') = 0,
  'ALTER TABLE `RequisitionLine` ADD CONSTRAINT `RequisitionLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RequisitionTimeline' AND CONSTRAINT_NAME = 'RequisitionTimeline_requisitionId_fkey') = 0,
  'ALTER TABLE `RequisitionTimeline` ADD CONSTRAINT `RequisitionTimeline_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `Requisition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RequisitionTimeline' AND CONSTRAINT_NAME = 'RequisitionTimeline_changedBy_fkey') = 0,
  'ALTER TABLE `RequisitionTimeline` ADD CONSTRAINT `RequisitionTimeline_changedBy_fkey` FOREIGN KEY (`changedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
