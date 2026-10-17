-- Fuel sales paid with coupons at the POS.

-- A client PIN, hashed, entered at the pump to pay with the client's coupons.
ALTER TABLE `Client` ADD COLUMN `pinHash` VARCHAR(191) NULL;

-- The `coupon` account type was added to the schema without a migration:
-- coupon sales are paid into an account of this type.
ALTER TABLE `CompanyAccount` MODIFY `type` ENUM('cash', 'bank', 'mobileMoney', 'transfer', 'card', 'coupon') NOT NULL;

-- When an initiated sale lapses; empty = never (coupon sales wait).
ALTER TABLE `GeneralTransaction` ADD COLUMN `expiresAt` DATETIME(3) NULL;

-- Sales still initiated keep the timeout they started with (10 minutes, the
-- default of MOBILE_SALE_TIMEOUT_MINUTES).
UPDATE `GeneralTransaction` SET `expiresAt` = DATE_ADD(`createdAt`, INTERVAL 10 MINUTE) WHERE `status` = 'initiated';
