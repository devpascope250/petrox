-- The pump rota no longer says which days an attendant works: the time table
-- (`TblTimeTable`) rosters people onto shifts by date, and that is what a sale
-- checks. So the weekday goes, and the seven weekday rows of one attendant on
-- one pump in one shift collapse into a single row holding all their nozzles.

-- The row that survives each (attendant, shift, pump), and what to fold into it.
CREATE TABLE `_rota_collapse` AS
  SELECT `userId`, `siteShiftId`, `pumpId`, MIN(`id`) AS `keepId`
  FROM `TblPumpAttendant`
  GROUP BY `userId`, `siteShiftId`, `pumpId`;

CREATE INDEX `_rota_collapse_key` ON `_rota_collapse`(`userId`, `siteShiftId`, `pumpId`);

-- Every nozzle of the rows being folded in moves to the surviving row.
UPDATE `PumpAttendantNozzle` `n`
  JOIN `TblPumpAttendant` `a` ON `a`.`id` = `n`.`pumpAttendantId`
  JOIN `_rota_collapse` `k`
    ON `k`.`userId` = `a`.`userId` AND `k`.`siteShiftId` = `a`.`siteShiftId` AND `k`.`pumpId` = `a`.`pumpId`
  SET `n`.`pumpAttendantId` = `k`.`keepId`;

-- The same nozzle on several weekdays is now the same nozzle several times.
-- The one copy to keep of each is settled before anything is deleted: a
-- self-join would stop matching the rows it has already removed, and leave
-- duplicates behind.
CREATE TABLE `_rota_nozzle_keep` AS
  SELECT MIN(`id`) AS `keepId`
  FROM `PumpAttendantNozzle`
  GROUP BY `pumpAttendantId`, `nozzleId`;

CREATE INDEX `_rota_nozzle_keep_id` ON `_rota_nozzle_keep`(`keepId`);

DELETE `n` FROM `PumpAttendantNozzle` `n`
  LEFT JOIN `_rota_nozzle_keep` `k` ON `k`.`keepId` = `n`.`id`
  WHERE `k`.`keepId` IS NULL;

DROP TABLE `_rota_nozzle_keep`;

-- The folded rows, now empty.
DELETE `a` FROM `TblPumpAttendant` `a`
  JOIN `_rota_collapse` `k`
    ON `k`.`userId` = `a`.`userId` AND `k`.`siteShiftId` = `a`.`siteShiftId` AND `k`.`pumpId` = `a`.`pumpId`
  WHERE `a`.`id` <> `k`.`keepId`;

DROP TABLE `_rota_collapse`;

ALTER TABLE `TblPumpAttendant` DROP COLUMN `day`;

CREATE UNIQUE INDEX `TblPumpAttendant_userId_siteShiftId_pumpId_key` ON `TblPumpAttendant`(`userId`, `siteShiftId`, `pumpId`);
CREATE UNIQUE INDEX `PumpAttendantNozzle_pumpAttendantId_nozzleId_key` ON `PumpAttendantNozzle`(`pumpAttendantId`, `nozzleId`);
