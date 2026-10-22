-- A PFI invoices a shipment, not a trip: it now belongs to the cargo rather
-- than to the nomination that loaded from it.
--
-- Rows already recorded are carried across by the path that linked the two: a
-- nomination loads vessels from stock, and each stock was received against a
-- cargo. A nomination that drew on several cargos keeps the earliest one — the
-- shipment it started from. Nothing is dropped: if any PFI cannot be placed on
-- a cargo the migration stops with that count, so the data is fixed by hand
-- rather than silently lost.
ALTER TABLE `Pfi` ADD COLUMN `cargoId` VARCHAR(191) NULL;

-- One cargo per nomination, materialised first: MySQL cannot read the table it
-- is updating inside a correlated subquery.
CREATE TEMPORARY TABLE `_pfi_cargo` AS
SELECT `nv`.`nominationId` AS `nominationId`, MIN(`s`.`cargoId`) AS `cargoId`
FROM `NominationVessel` `nv`
JOIN `Stock` `s` ON `s`.`id` = `nv`.`stockId`
GROUP BY `nv`.`nominationId`;

UPDATE `Pfi` `p`
JOIN `_pfi_cargo` `m` ON `m`.`nominationId` = `p`.`nominationId`
SET `p`.`cargoId` = `m`.`cargoId`;

DROP TEMPORARY TABLE `_pfi_cargo`;

-- Stops here when a PFI's nomination never loaded from any stock, so there is
-- no cargo to move it to.
SET @orphans = (SELECT COUNT(*) FROM `Pfi` WHERE `cargoId` IS NULL);
SET @message = CONCAT(@orphans, ' PFI(s) have no cargo to move to: their nomination loaded no stock. Point them at a cargo, then run this again.');
DROP PROCEDURE IF EXISTS `_pfi_check`;
CREATE PROCEDURE `_pfi_check`()
BEGIN
  IF @orphans > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PFI rows cannot be moved to a cargo; see the migration';
  END IF;
END;
CALL `_pfi_check`();
DROP PROCEDURE `_pfi_check`;

-- The nomination link goes, and the cargo link takes its place.
ALTER TABLE `Pfi` DROP FOREIGN KEY `Pfi_nominationId_fkey`;
DROP INDEX `Pfi_nominationId_idx` ON `Pfi`;
ALTER TABLE `Pfi` DROP COLUMN `nominationId`;

ALTER TABLE `Pfi` MODIFY COLUMN `cargoId` VARCHAR(191) NOT NULL;
CREATE INDEX `Pfi_cargoId_idx` ON `Pfi`(`cargoId`);
ALTER TABLE `Pfi` ADD CONSTRAINT `Pfi_cargoId_fkey` FOREIGN KEY (`cargoId`) REFERENCES `Cargo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
