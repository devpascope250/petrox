-- Parkings, the vehicles standing in them, and the stage that comes between a
-- released T1 and stock being received.
--
-- A vehicle in transit may be parked and still be in transit: it moves from
-- parking to parking until it is offloaded. So `VehicleLocation` is a log of
-- where a vehicle has stood on a trip, not a stage — the stage is `inTransit`,
-- set by hand once the truck leaves, and it stays until the stock arrives.

CREATE TABLE `Parking` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `location` VARCHAR(191) NOT NULL,
  `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `Parking_name_location_key`(`name`, `location`),
  INDEX `Parking_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `VehicleLocation` (
  `id` VARCHAR(191) NOT NULL,
  `parkingId` VARCHAR(191) NOT NULL,
  `driverVehicleId` VARCHAR(191) NOT NULL,
  `nominationId` VARCHAR(191) NOT NULL,
  `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `arrivedAt` DATETIME(3) NULL,
  `releasedAt` DATETIME(3) NULL,
  `assignedBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `VehicleLocation_driverVehicleId_status_idx`(`driverVehicleId`, `status`),
  INDEX `VehicleLocation_nominationId_status_idx`(`nominationId`, `status`),
  INDEX `VehicleLocation_parkingId_status_idx`(`parkingId`, `status`),
  INDEX `VehicleLocation_createdAt_idx`(`createdAt`),
  INDEX `VehicleLocation_assignedBy_idx`(`assignedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `VehicleLocation` ADD CONSTRAINT `VehicleLocation_parkingId_fkey`
  FOREIGN KEY (`parkingId`) REFERENCES `Parking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VehicleLocation` ADD CONSTRAINT `VehicleLocation_driverVehicleId_fkey`
  FOREIGN KEY (`driverVehicleId`) REFERENCES `DriverVehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VehicleLocation` ADD CONSTRAINT `VehicleLocation_nominationId_fkey`
  FOREIGN KEY (`nominationId`) REFERENCES `Nomination`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VehicleLocation` ADD CONSTRAINT `VehicleLocation_assignedBy_fkey`
  FOREIGN KEY (`assignedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The new value is appended, not inserted: MySQL stores an enum by index, and
-- the ladder's order comes from `level` below.
ALTER TABLE `NominationTimeLineStatus`
  MODIFY `status` ENUM('awaiting', 'underLoading', 't1Pending', 't1Confirmed', 'stockReceived', 'inTransit') NOT NULL;

-- Stock received moves up to make room, then the new rung takes level 5. Done
-- here as well as in the seed, so a deploy that does not re-seed still has it.
UPDATE `NominationTimeLineStatus` SET `level` = 6 WHERE `status` = 'stockReceived';

INSERT INTO `NominationTimeLineStatus` (`id`, `status`, `level`, `descriptions`, `createdAt`, `updatedAt`)
SELECT UUID(), 'inTransit', 5, 'In transit, parked or moving between parkings', NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `NominationTimeLineStatus` WHERE `status` = 'inTransit');

-- Level 4 no longer has to describe transit and parking as well as release.
UPDATE `NominationTimeLineStatus`
SET `descriptions` = 'Released by customs'
WHERE `status` = 't1Confirmed';
