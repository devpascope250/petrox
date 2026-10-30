-- The standing arrangement: who is on which pump on a weekday of a shift.
--
-- A plan is not a record of anything that happened. It is how the rota gets
-- filled in: rostering someone on a date writes their pump assignment for that
-- date from the plan matching its weekday, so the time table only ever needs
-- the pompist, the day and the shift.
--
-- What was actually worked stays on `TblPumpAttendant`, one row per rostered
-- day, where editing a plan cannot reach back and rewrite it. That separation
-- is the whole point: a plan says what usually happens, the rota says what did.
--
-- `weekday` counts 1 = Monday … 7 = Sunday, the same as `TblTimeTable.days`.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, and `CREATE TABLE IF NOT EXISTS` plus guarded foreign
-- keys make every step check for itself whether it is still to do.

-- CreateTable
CREATE TABLE IF NOT EXISTS `PumpAttendantPlan` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `siteShiftId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `pumpId` VARCHAR(191) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

INDEX `PumpAttendantPlan_siteId_weekday_idx`(`siteId`, `weekday`),
    INDEX `PumpAttendantPlan_siteShiftId_idx`(`siteShiftId`),
    INDEX `PumpAttendantPlan_userId_idx`(`userId`),
    INDEX `PumpAttendantPlan_pumpId_idx`(`pumpId`),
    INDEX `PumpAttendantPlan_createdBy_idx`(`createdBy`),
    UNIQUE INDEX `PumpAttendantPlan_siteShiftId_userId_weekday_pumpId_key`(`siteShiftId`, `userId`, `weekday`, `pumpId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `PumpAttendantPlanNozzle` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `nozzleId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

INDEX `PumpAttendantPlanNozzle_planId_idx`(`planId`),
    INDEX `PumpAttendantPlanNozzle_nozzleId_idx`(`nozzleId`),
    UNIQUE INDEX `PumpAttendantPlanNozzle_planId_nozzleId_key`(`planId`, `nozzleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlan'
      AND CONSTRAINT_NAME = 'PumpAttendantPlan_siteId_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlan` ADD CONSTRAINT `PumpAttendantPlan_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlan'
      AND CONSTRAINT_NAME = 'PumpAttendantPlan_siteShiftId_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlan` ADD CONSTRAINT `PumpAttendantPlan_siteShiftId_fkey` FOREIGN KEY (`siteShiftId`) REFERENCES `TblShiftSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlan'
      AND CONSTRAINT_NAME = 'PumpAttendantPlan_userId_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlan` ADD CONSTRAINT `PumpAttendantPlan_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlan'
      AND CONSTRAINT_NAME = 'PumpAttendantPlan_pumpId_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlan` ADD CONSTRAINT `PumpAttendantPlan_pumpId_fkey` FOREIGN KEY (`pumpId`) REFERENCES `TblPump`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlan'
      AND CONSTRAINT_NAME = 'PumpAttendantPlan_createdBy_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlan` ADD CONSTRAINT `PumpAttendantPlan_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlanNozzle'
      AND CONSTRAINT_NAME = 'PumpAttendantPlanNozzle_planId_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlanNozzle` ADD CONSTRAINT `PumpAttendantPlanNozzle_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `PumpAttendantPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PumpAttendantPlanNozzle'
      AND CONSTRAINT_NAME = 'PumpAttendantPlanNozzle_nozzleId_fkey') = 0,
  'ALTER TABLE `PumpAttendantPlanNozzle` ADD CONSTRAINT `PumpAttendantPlanNozzle_nozzleId_fkey` FOREIGN KEY (`nozzleId`) REFERENCES `TblNozzle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
