-- Landing fees belong to central stock, not to a depot stock receipt.
--
-- The cost of landing a load is known when it is received into the depot,
-- which is when a `CentralStock` row is written — so that is where the charge
-- belongs. `ChainStockFee.stockId` becomes `centralStockId`.
--
-- Rows already charged are **carried over, never dropped**. A stock receipt
-- reaches central stock along one path:
--
--   Stock → NominationVessel → Nomination → T1Validation → CentralStock
--
-- A stock may have been loaded by several nominations, so that path can lead
-- to more than one central stock receipt. Where it leads to exactly one, the
-- charge is moved to it. Where it is ambiguous or leads nowhere, this
-- migration **stops with an error** rather than guessing or discarding: the
-- rows must be moved by hand first, and the message says how many there are.

-- 1. The new column, nullable while the rows are carried over.
ALTER TABLE `ChainStockFee` ADD COLUMN `centralStockId` VARCHAR(191) NULL;

-- 2. Where the chain leads to exactly one central stock receipt, move it there.
UPDATE `ChainStockFee` AS fee
SET `centralStockId` = (
  SELECT MIN(cs.`id`)
  FROM `NominationVessel` nv
  JOIN `T1Validation` t1 ON t1.`nominationId` = nv.`nominationId`
  JOIN `CentralStock` cs ON cs.`t1ValidationId` = t1.`id`
  WHERE nv.`stockId` = fee.`stockId`
  HAVING COUNT(DISTINCT cs.`id`) = 1
)
WHERE fee.`centralStockId` IS NULL;

-- 3. Stop rather than lose anything that could not be placed. A charge left
-- unplaced means its stock reaches no central stock receipt, or reaches more
-- than one: move those rows by hand, then run this again.
SET @orphans = (SELECT COUNT(*) FROM `ChainStockFee` WHERE `centralStockId` IS NULL);
DROP PROCEDURE IF EXISTS `_fee_check`;
CREATE PROCEDURE `_fee_check`()
BEGIN
  IF @orphans > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
      'ChainStockFee rows cannot be moved to a central stock receipt; see the migration';
  END IF;
END;
CALL `_fee_check`();
DROP PROCEDURE `_fee_check`;

-- 4. Replace the old key with the new one.
ALTER TABLE `ChainStockFee` DROP FOREIGN KEY `ChainStockFee_stockId_fkey`;
DROP INDEX `ChainStockFee_stockId_feeTypeId_key` ON `ChainStockFee`;
DROP INDEX `ChainStockFee_stockId_idx` ON `ChainStockFee`;
ALTER TABLE `ChainStockFee` DROP COLUMN `stockId`;

ALTER TABLE `ChainStockFee` MODIFY `centralStockId` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `ChainStockFee_centralStockId_feeTypeId_key`
  ON `ChainStockFee`(`centralStockId`, `feeTypeId`);
CREATE INDEX `ChainStockFee_centralStockId_idx` ON `ChainStockFee`(`centralStockId`);

ALTER TABLE `ChainStockFee`
  ADD CONSTRAINT `ChainStockFee_centralStockId_fkey` FOREIGN KEY (`centralStockId`)
  REFERENCES `CentralStock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
