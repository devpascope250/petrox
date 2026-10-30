-- Pump index readings: one nozzle's meter at the open and close of a shift.
--
-- A nozzle's readings are a chain — `startIndex` is the previous reading's
-- `endIndex`, so only the closing figure is ever typed, and the first reading
-- on a nozzle carries the counter as it stood when the station started
-- recording. The litres through the nozzle over a shift are the difference, and
-- `sellingPrice` is a snapshot of the price in force, so a later price change
-- cannot rewrite what that shift sold at.
--
-- `dateOn` is the working day, as `FuelSale` and `TblTimeTable` count it: a
-- shift repeats every day, so the shift alone cannot say which reading is
-- which. The unique key on (nozzle, shift, day) makes a second reading for the
-- same shift impossible rather than merely discouraged.
--
-- Approved (`confirmedBy`) is final: nothing deletes a reading and nothing
-- edits one after that, so the chain behind it cannot be rewritten. The
-- approver is cleared rather than blocking a user's removal; everything else
-- the reading points at must stay.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

CREATE TABLE IF NOT EXISTS `PumpIndex` (
    `id` VARCHAR(191) NOT NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `nozzleId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `sellingPrice` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `shiftSiteId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `dateOn` DATE NOT NULL,
    `startIndex` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `endIndex` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `createdBy` VARCHAR(191) NOT NULL,
    `confirmedBy` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PumpIndex_siteId_dateOn_idx`(`siteId`, `dateOn`),
    INDEX `PumpIndex_nozzleId_dateOn_idx`(`nozzleId`, `dateOn`),
    INDEX `PumpIndex_pumpId_idx`(`pumpId`),
    INDEX `PumpIndex_itemId_idx`(`itemId`),
    INDEX `PumpIndex_shiftSiteId_idx`(`shiftSiteId`),
    INDEX `PumpIndex_createdBy_idx`(`createdBy`),
    INDEX `PumpIndex_confirmedBy_idx`(`confirmedBy`),
    UNIQUE INDEX `PumpIndex_nozzleId_shiftSiteId_dateOn_key`(`nozzleId`, `shiftSiteId`, `dateOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The foreign keys, each added only if it is not there yet.
SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_pumpId_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_pumpId_fkey`
     FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_nozzleId_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_nozzleId_fkey`
     FOREIGN KEY (`nozzleId`) REFERENCES `TblNozzle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_itemId_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_itemId_fkey`
     FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_shiftSiteId_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_shiftSiteId_fkey`
     FOREIGN KEY (`shiftSiteId`) REFERENCES `TblShiftSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_siteId_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_siteId_fkey`
     FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_createdBy_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_createdBy_fkey`
     FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpIndex'
      AND CONSTRAINT_NAME = 'PumpIndex_confirmedBy_fkey') = 0,
  'ALTER TABLE `PumpIndex` ADD CONSTRAINT `PumpIndex_confirmedBy_fkey`
     FOREIGN KEY (`confirmedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
