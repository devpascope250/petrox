-- Where a tolerance statement is sent, and a record of each one sent.
--
-- `Transporter.email` is nullable: the transporters already on record were
-- entered without one, and an address is only needed to share a statement —
-- not to carry a load.
--
-- `ToleranceReportShare` keeps what was sent and to whom, with the totals
-- **copied as they stood that day**. Both halves of the argument come up in
-- practice — "we never received it" and "that is not what you sent us" — and
-- a receipt corrected afterwards must not quietly change what the transporter
-- was told at the time.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Transporter' AND COLUMN_NAME = 'email') = 0,
  'ALTER TABLE `Transporter` ADD COLUMN `email` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

CREATE TABLE IF NOT EXISTS `ToleranceReportShare` (
    `id` VARCHAR(191) NOT NULL,
    `transporterId` VARCHAR(191) NOT NULL,
    `sentTo` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `trips` INTEGER NOT NULL DEFAULT 0,
    `carriedQty` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `lossQty` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `gainQty` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `chargeableQty` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `sentBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ToleranceReportShare_transporterId_createdAt_idx`(`transporterId`, `createdAt`),
    INDEX `ToleranceReportShare_sentBy_idx`(`sentBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ToleranceReportShare'
      AND CONSTRAINT_NAME = 'ToleranceReportShare_transporterId_fkey') = 0,
  'ALTER TABLE `ToleranceReportShare` ADD CONSTRAINT `ToleranceReportShare_transporterId_fkey` FOREIGN KEY (`transporterId`) REFERENCES `Transporter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ToleranceReportShare'
      AND CONSTRAINT_NAME = 'ToleranceReportShare_sentBy_fkey') = 0,
  'ALTER TABLE `ToleranceReportShare` ADD CONSTRAINT `ToleranceReportShare_sentBy_fkey` FOREIGN KEY (`sentBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
