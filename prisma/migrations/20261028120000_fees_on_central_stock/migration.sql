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
-- to more than one central stock receipt; and a stock not yet received
-- centrally reaches none at all. Where it leads to exactly one, the charge is
-- moved to it. Otherwise this migration **stops with an error** rather than
-- guessing or discarding — `pnpm fees:placement` reports what is left and
-- places it.
--
-- Every step is written to be **safely re-runnable**: MySQL cannot roll back
-- DDL, so a run that stops at the guard leaves the new column behind, and the
-- next run must carry on from there rather than fail on it.

-- 1. The new column, nullable while the rows are carried over.
SET @hasNew = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee' AND COLUMN_NAME = 'centralStockId'
);
SET @sql = IF(@hasNew = 0,
  'ALTER TABLE `ChainStockFee` ADD COLUMN `centralStockId` VARCHAR(191) NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Where the chain leads to exactly one central stock receipt, move it
-- there. Skipped once `stockId` is gone, which means this already ran.
SET @hasOld = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee' AND COLUMN_NAME = 'stockId'
);
SET @sql = IF(@hasOld = 1, '
  UPDATE `ChainStockFee` AS fee
  SET `centralStockId` = (
    SELECT MIN(cs.`id`)
    FROM `NominationVessel` nv
    JOIN `T1Validation` t1 ON t1.`nominationId` = nv.`nominationId`
    JOIN `CentralStock` cs ON cs.`t1ValidationId` = t1.`id`
    WHERE nv.`stockId` = fee.`stockId`
    HAVING COUNT(DISTINCT cs.`id`) = 1
  )
  WHERE fee.`centralStockId` IS NULL
', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Stop rather than lose anything that could not be placed. A charge left
-- unplaced means its stock reaches no central stock receipt, or reaches more
-- than one. Run `pnpm fees:placement` to see which, place them, and then run
-- this migration again.
SET @orphans = (SELECT COUNT(*) FROM `ChainStockFee` WHERE `centralStockId` IS NULL);
DROP PROCEDURE IF EXISTS `_fee_check`;
CREATE PROCEDURE `_fee_check`()
BEGIN
  IF @orphans > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
      'ChainStockFee rows cannot be moved to a central stock receipt; run `pnpm fees:placement`';
  END IF;
END;
CALL `_fee_check`();
DROP PROCEDURE `_fee_check`;

-- 4. Replace the old key with the new one, each step only if still needed.
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'
    AND CONSTRAINT_NAME = 'ChainStockFee_stockId_fkey'
);
SET @sql = IF(@fk = 1, 'ALTER TABLE `ChainStockFee` DROP FOREIGN KEY `ChainStockFee_stockId_fkey`', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ix = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'
    AND INDEX_NAME = 'ChainStockFee_stockId_feeTypeId_key'
);
SET @sql = IF(@ix > 0, 'DROP INDEX `ChainStockFee_stockId_feeTypeId_key` ON `ChainStockFee`', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ix = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'
    AND INDEX_NAME = 'ChainStockFee_stockId_idx'
);
SET @sql = IF(@ix > 0, 'DROP INDEX `ChainStockFee_stockId_idx` ON `ChainStockFee`', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @hasOld = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee' AND COLUMN_NAME = 'stockId'
);
SET @sql = IF(@hasOld = 1, 'ALTER TABLE `ChainStockFee` DROP COLUMN `stockId`', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Every row is placed by now, so the column can carry its NOT NULL.
ALTER TABLE `ChainStockFee` MODIFY `centralStockId` VARCHAR(191) NOT NULL;

SET @ix = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'
    AND INDEX_NAME = 'ChainStockFee_centralStockId_feeTypeId_key'
);
SET @sql = IF(@ix = 0,
  'CREATE UNIQUE INDEX `ChainStockFee_centralStockId_feeTypeId_key` ON `ChainStockFee`(`centralStockId`, `feeTypeId`)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ix = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'
    AND INDEX_NAME = 'ChainStockFee_centralStockId_idx'
);
SET @sql = IF(@ix = 0,
  'CREATE INDEX `ChainStockFee_centralStockId_idx` ON `ChainStockFee`(`centralStockId`)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'
    AND CONSTRAINT_NAME = 'ChainStockFee_centralStockId_fkey'
);
SET @sql = IF(@fk = 0, '
  ALTER TABLE `ChainStockFee`
  ADD CONSTRAINT `ChainStockFee_centralStockId_fkey` FOREIGN KEY (`centralStockId`)
  REFERENCES `CentralStock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
