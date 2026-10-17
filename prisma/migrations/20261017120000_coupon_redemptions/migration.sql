-- Coupons: the paper coupon's status is split from how much of its value is
-- spent (usage), each coupon keeps what is left (remainingAmount), plans may
-- set a validity, and every spend is recorded (CouponRedemption).

-- 1. New columns. remainingAmount starts at 0 here and is filled below.
ALTER TABLE `ClientCoupon` ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `remainingAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `usage` ENUM('unused', 'partiallyUsed', 'used', 'expired') NOT NULL DEFAULT 'unused';

ALTER TABLE `CouponPlan` ADD COLUMN `validityDays` INTEGER NULL;

-- 2. Usage from the old status: scanned, called and used were spent at a
--    station; expired ones kept their value but can no longer be spent.
UPDATE `ClientCoupon` SET `usage` = 'used', `remainingAmount` = 0
  WHERE `status` IN ('scanned', 'called', 'used');
UPDATE `ClientCoupon` SET `usage` = 'expired', `remainingAmount` = `amount`, `expiresAt` = `updatedAt`
  WHERE `status` = 'expired';
UPDATE `ClientCoupon` SET `remainingAmount` = `amount`
  WHERE `status` IN ('available', 'printed', 'cancelled');

-- 3. The old statuses that described usage become a paper status: printed
--    when it was printed, available otherwise.
UPDATE `ClientCoupon` SET `status` = IF(`printedAt` IS NULL, 'available', 'printed')
  WHERE `status` IN ('scanned', 'called', 'used', 'expired');

-- 4. Only now narrow the status list, and drop the temporary default.
ALTER TABLE `ClientCoupon` MODIFY `status` ENUM('available', 'printed', 'cancelled') NOT NULL DEFAULT 'available',
    ALTER COLUMN `remainingAmount` DROP DEFAULT;

-- 5. Every spend of a coupon on a POS sale.
CREATE TABLE `CouponRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `clientCouponId` VARCHAR(191) NOT NULL,
    `generalTransactionId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `redeemedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CouponRedemption_generalTransactionId_idx`(`generalTransactionId`),
    INDEX `CouponRedemption_siteId_idx`(`siteId`),
    INDEX `CouponRedemption_redeemedBy_idx`(`redeemedBy`),
    UNIQUE INDEX `CouponRedemption_clientCouponId_generalTransactionId_key`(`clientCouponId`, `generalTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_clientCouponId_fkey` FOREIGN KEY (`clientCouponId`) REFERENCES `ClientCoupon`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_generalTransactionId_fkey` FOREIGN KEY (`generalTransactionId`) REFERENCES `GeneralTransaction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `TblSite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_redeemedBy_fkey` FOREIGN KEY (`redeemedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
