-- What the state pays towards a litre of a product, for a period.
--
-- The table was declared in the schema but never created, so this migration
-- creates it. Nothing reads it yet, so there is no data to carry over.
--
-- There is no unique index on (itemId, status): MySQL cannot express "at most
-- one active row per item" — a partial unique index would be needed — so that
-- invariant is kept by the write transaction in `subsidy.repository.ts`,
-- which retires the active subsidy of the product before writing a new one.

CREATE TABLE `Subsidy` (
  `id`        VARCHAR(191) NOT NULL,
  `itemId`    VARCHAR(191) NOT NULL,
  `siteId`    VARCHAR(191) NULL,
  `rate`      DECIMAL(12, 2) NOT NULL,
  `from`      DATE NOT NULL,
  `to`        DATE NOT NULL,
  `status`    ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `note`      VARCHAR(191) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated`   DATETIME(3) NOT NULL,

  INDEX `Subsidy_itemId_status_idx`(`itemId`, `status`),
  INDEX `Subsidy_siteId_idx`(`siteId`),
  INDEX `Subsidy_createdBy_idx`(`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Subsidy`
  ADD CONSTRAINT `Subsidy_itemId_fkey` FOREIGN KEY (`itemId`)
  REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The site is optional, so removing a site leaves its subsidies in place as
-- company-wide ones rather than blocking the deletion.
ALTER TABLE `Subsidy`
  ADD CONSTRAINT `Subsidy_siteId_fkey` FOREIGN KEY (`siteId`)
  REFERENCES `TblSite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Subsidy`
  ADD CONSTRAINT `Subsidy_createdBy_fkey` FOREIGN KEY (`createdBy`)
  REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
