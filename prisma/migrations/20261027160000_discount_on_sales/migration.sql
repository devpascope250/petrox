-- What a discount took off a sale, copied onto the sale itself.
--
-- `discountRate` and `discountAmount` are the sale's own figures, snapshots of
-- the discount at the moment it was priced, so editing or retiring a discount
-- later cannot rewrite what a customer was charged. `discountId` only traces
-- it back, and is cleared rather than blocking a delete.
--
-- Both columns default to zero, so every sale already recorded reads as sold
-- at full price, which is what it was.

ALTER TABLE `FuelSale`
  ADD COLUMN `discountId` VARCHAR(191) NULL,
  ADD COLUMN `discountRate` DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00;

CREATE INDEX `FuelSale_discountId_idx` ON `FuelSale`(`discountId`);

ALTER TABLE `FuelSale`
  ADD CONSTRAINT `FuelSale_discountId_fkey` FOREIGN KEY (`discountId`)
  REFERENCES `Discount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- `GeneralTransaction.discountAmount` is there already.
ALTER TABLE `GeneralTransaction`
  ADD COLUMN `discountId` VARCHAR(191) NULL,
  ADD COLUMN `discountRate` DECIMAL(18, 2) NOT NULL DEFAULT 0.00;

CREATE INDEX `GeneralTransaction_discountId_idx` ON `GeneralTransaction`(`discountId`);

ALTER TABLE `GeneralTransaction`
  ADD CONSTRAINT `GeneralTransaction_discountId_fkey` FOREIGN KEY (`discountId`)
  REFERENCES `Discount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
