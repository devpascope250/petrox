-- Fees on stock and proformas, signatures on an authorisation, a record of a
-- loading order being shared, and the edit loop on a stock request.
--
-- Nothing existing is dropped or rewritten: every column added to a table that
-- already holds rows is nullable or carries a default, and the new tables start
-- empty. `User.signatureUrl` is added as NULL — most users never sign anything,
-- and an authoriser without a signature is refused at approval instead.

-- A user's signature, stamped onto documents they authorise.
ALTER TABLE `User` ADD COLUMN `signatureUrl` VARCHAR(191) NULL;

-- The signature and name as they were when an approval was given. Copies, so a
-- document already signed cannot change under it.
ALTER TABLE `LoadingOrderAuthorizer`
  ADD COLUMN `signatureUrl` VARCHAR(191) NULL,
  ADD COLUMN `signedName` VARCHAR(191) NULL;

-- A stock request can be sent back to be changed.
ALTER TABLE `CentralStockOrder`
  MODIFY `status` ENUM('pending', 'approved', 'rejected', 'cancelled', 'editing') NOT NULL DEFAULT 'pending';

CREATE TABLE `FeeType` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(18, 2) NOT NULL,
  `currencyCode` VARCHAR(191) NOT NULL DEFAULT 'RWF',
  `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `FeeType_name_key`(`name`),
  INDEX `FeeType_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- `name`, `unitAmount` and `currencyCode` are copies taken when the fee was
-- charged, so a landed cost worked out last quarter does not move when a price
-- is edited today.
CREATE TABLE `ChainStockFee` (
  `id` VARCHAR(191) NOT NULL,
  `feeTypeId` VARCHAR(191) NOT NULL,
  `stockId` VARCHAR(191) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 1,
  `name` VARCHAR(191) NOT NULL,
  `unitAmount` DECIMAL(18, 2) NOT NULL,
  `currencyCode` VARCHAR(191) NOT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ChainStockFee_stockId_feeTypeId_key`(`stockId`, `feeTypeId`),
  INDEX `ChainStockFee_stockId_idx`(`stockId`),
  INDEX `ChainStockFee_feeTypeId_idx`(`feeTypeId`),
  INDEX `ChainStockFee_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PfiFee` (
  `id` VARCHAR(191) NOT NULL,
  `feeTypeId` VARCHAR(191) NOT NULL,
  `pfiId` VARCHAR(191) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 1,
  `name` VARCHAR(191) NOT NULL,
  `unitAmount` DECIMAL(18, 2) NOT NULL,
  `currencyCode` VARCHAR(191) NOT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PfiFee_pfiId_feeTypeId_key`(`pfiId`, `feeTypeId`),
  INDEX `PfiFee_pfiId_idx`(`pfiId`),
  INDEX `PfiFee_feeTypeId_idx`(`feeTypeId`),
  INDEX `PfiFee_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LoadingOrderShare` (
  `id` VARCHAR(191) NOT NULL,
  `loadingOrderId` VARCHAR(191) NOT NULL,
  `recipients` TEXT NOT NULL,
  `message` TEXT NULL,
  `sharedBy` VARCHAR(191) NOT NULL,
  `sentAt` DATETIME(3) NULL,
  `failedReason` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `LoadingOrderShare_loadingOrderId_idx`(`loadingOrderId`),
  INDEX `LoadingOrderShare_sharedBy_idx`(`sharedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CentralStockOrderEvent` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `action` ENUM('requested', 'editRequested', 'edited', 'approved', 'rejected', 'cancelled') NOT NULL,
  `comment` TEXT NULL,
  `fromQuantity` DECIMAL(18, 2) NULL,
  `toQuantity` DECIMAL(18, 2) NULL,
  `actedBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `CentralStockOrderEvent_orderId_idx`(`orderId`),
  INDEX `CentralStockOrderEvent_actedBy_idx`(`actedBy`),
  INDEX `CentralStockOrderEvent_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChainStockFee` ADD CONSTRAINT `ChainStockFee_feeTypeId_fkey`
  FOREIGN KEY (`feeTypeId`) REFERENCES `FeeType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ChainStockFee` ADD CONSTRAINT `ChainStockFee_stockId_fkey`
  FOREIGN KEY (`stockId`) REFERENCES `Stock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ChainStockFee` ADD CONSTRAINT `ChainStockFee_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PfiFee` ADD CONSTRAINT `PfiFee_feeTypeId_fkey`
  FOREIGN KEY (`feeTypeId`) REFERENCES `FeeType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PfiFee` ADD CONSTRAINT `PfiFee_pfiId_fkey`
  FOREIGN KEY (`pfiId`) REFERENCES `Pfi`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PfiFee` ADD CONSTRAINT `PfiFee_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `LoadingOrderShare` ADD CONSTRAINT `LoadingOrderShare_loadingOrderId_fkey`
  FOREIGN KEY (`loadingOrderId`) REFERENCES `LoadingOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoadingOrderShare` ADD CONSTRAINT `LoadingOrderShare_sharedBy_fkey`
  FOREIGN KEY (`sharedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CentralStockOrderEvent` ADD CONSTRAINT `CentralStockOrderEvent_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `CentralStockOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CentralStockOrderEvent` ADD CONSTRAINT `CentralStockOrderEvent_actedBy_fkey`
  FOREIGN KEY (`actedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
