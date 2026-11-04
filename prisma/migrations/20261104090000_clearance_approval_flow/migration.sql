-- Clearing stock becomes an act that is approved and paid for.
--
-- Until now a clearance was one row per receipt, cleared the instant it was
-- written. A FIFO clearance draws on as many receipts as it needs, so one
-- click can write several rows — and the taxes, the approvals and the payment
-- belong to the act, not to each receipt it happened to touch.
--
-- `ClearanceRequest` is that act. The `StockClearance` rows hang off it
-- (`requestId`, nullable: the rows raised before this migration belong to no
-- request and stay as they are). Raising one **holds** the litres so nobody
-- else can claim them, but moves no stock: it stays uncleared until every
-- active authorizer has approved and the payment doc has been confirmed.
--
-- `TaxDescription` is a catalogue of tax codes and nothing more. What each one
-- comes to is typed per clearance in `TaxClearance`, which **copies** the code
-- it was charged under, so retiring or renaming a tax never rewrites history.
--
-- `ClearanceAuthorizerMember` is who may approve — named people, not roles,
-- because each of them is emailed the moment a clearance is raised.
-- `ClearanceAuthorizer` is how one of them went on one clearance, changed in
-- place so somebody who rejected can come back and approve.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockClearance' AND COLUMN_NAME = 'requestId') = 0,
  'ALTER TABLE `StockClearance` ADD COLUMN `requestId` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

CREATE TABLE IF NOT EXISTS `TaxDescription` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TaxDescription_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ClearanceRequest` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `fees` DECIMAL(18, 2) NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `agentId` VARCHAR(191) NULL,
    `dmsDocUrl` VARCHAR(191) NULL,
    `assessmentDocUrl` VARCHAR(191) NULL,
    `supportingDocUrl` VARCHAR(191) NULL,
    `clearanceStatus` ENUM('awaiting', 'approved', 'rejected') NOT NULL DEFAULT 'awaiting',
    `paymentDocUrl` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `paidBy` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClearanceRequest_itemId_idx`(`itemId`),
    INDEX `ClearanceRequest_agentId_idx`(`agentId`),
    INDEX `ClearanceRequest_clearanceStatus_idx`(`clearanceStatus`),
    INDEX `ClearanceRequest_createdBy_idx`(`createdBy`),
    INDEX `ClearanceRequest_paidBy_idx`(`paidBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `TaxClearance` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `taxId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.0,
    `recordedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TaxClearance_requestId_idx`(`requestId`),
    INDEX `TaxClearance_taxId_idx`(`taxId`),
    INDEX `TaxClearance_recordedBy_idx`(`recordedBy`),
    UNIQUE INDEX `TaxClearance_requestId_taxId_key`(`requestId`, `taxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ClearanceAuthorizerMember` (
    `id` VARCHAR(191) NOT NULL,
    `authorizerId` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `level` INTEGER NULL,
    `position` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ClearanceAuthorizerMember_authorizerId_key`(`authorizerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ClearanceAuthorizer` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `authorizerId` VARCHAR(191) NOT NULL,
    `status` ENUM('awaiting', 'approved', 'rejected') NOT NULL DEFAULT 'awaiting',
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClearanceAuthorizer_requestId_idx`(`requestId`),
    INDEX `ClearanceAuthorizer_authorizerId_idx`(`authorizerId`),
    UNIQUE INDEX `ClearanceAuthorizer_requestId_authorizerId_key`(`requestId`, `authorizerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockClearance' AND INDEX_NAME = 'StockClearance_requestId_idx') = 0,
  'CREATE INDEX `StockClearance_requestId_idx` ON `StockClearance`(`requestId`)',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockClearance'
      AND CONSTRAINT_NAME = 'StockClearance_requestId_fkey') = 0,
  'ALTER TABLE `StockClearance` ADD CONSTRAINT `StockClearance_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ClearanceRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceRequest'
      AND CONSTRAINT_NAME = 'ClearanceRequest_itemId_fkey') = 0,
  'ALTER TABLE `ClearanceRequest` ADD CONSTRAINT `ClearanceRequest_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceRequest'
      AND CONSTRAINT_NAME = 'ClearanceRequest_agentId_fkey') = 0,
  'ALTER TABLE `ClearanceRequest` ADD CONSTRAINT `ClearanceRequest_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `ClearingAgent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceRequest'
      AND CONSTRAINT_NAME = 'ClearanceRequest_paidBy_fkey') = 0,
  'ALTER TABLE `ClearanceRequest` ADD CONSTRAINT `ClearanceRequest_paidBy_fkey` FOREIGN KEY (`paidBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceRequest'
      AND CONSTRAINT_NAME = 'ClearanceRequest_createdBy_fkey') = 0,
  'ALTER TABLE `ClearanceRequest` ADD CONSTRAINT `ClearanceRequest_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TaxClearance'
      AND CONSTRAINT_NAME = 'TaxClearance_requestId_fkey') = 0,
  'ALTER TABLE `TaxClearance` ADD CONSTRAINT `TaxClearance_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ClearanceRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TaxClearance'
      AND CONSTRAINT_NAME = 'TaxClearance_taxId_fkey') = 0,
  'ALTER TABLE `TaxClearance` ADD CONSTRAINT `TaxClearance_taxId_fkey` FOREIGN KEY (`taxId`) REFERENCES `TaxDescription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TaxClearance'
      AND CONSTRAINT_NAME = 'TaxClearance_recordedBy_fkey') = 0,
  'ALTER TABLE `TaxClearance` ADD CONSTRAINT `TaxClearance_recordedBy_fkey` FOREIGN KEY (`recordedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceAuthorizerMember'
      AND CONSTRAINT_NAME = 'ClearanceAuthorizerMember_authorizerId_fkey') = 0,
  'ALTER TABLE `ClearanceAuthorizerMember` ADD CONSTRAINT `ClearanceAuthorizerMember_authorizerId_fkey` FOREIGN KEY (`authorizerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceAuthorizer'
      AND CONSTRAINT_NAME = 'ClearanceAuthorizer_requestId_fkey') = 0,
  'ALTER TABLE `ClearanceAuthorizer` ADD CONSTRAINT `ClearanceAuthorizer_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ClearanceRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ClearanceAuthorizer'
      AND CONSTRAINT_NAME = 'ClearanceAuthorizer_authorizerId_fkey') = 0,
  'ALTER TABLE `ClearanceAuthorizer` ADD CONSTRAINT `ClearanceAuthorizer_authorizerId_fkey` FOREIGN KEY (`authorizerId`) REFERENCES `ClearanceAuthorizerMember`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
