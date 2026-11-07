-- Who to call at a supplier, where to write to them, and their paperwork.
--
-- All three are nullable: every supplier already on record was entered without
-- them, and none is needed to buy fuel — a purchase needs the business, not a
-- named person. `documentUrl` holds a **path** (`/uploads/…`), like every other
-- upload in this schema, so the stored value does not depend on the domain.
--
-- Written so it can be run again after a part-way failure: MySQL has no
-- transactional DDL, so each step checks for itself whether it is still to do.

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Supplier' AND COLUMN_NAME = 'contactPerson') = 0,
  'ALTER TABLE `Supplier` ADD COLUMN `contactPerson` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Supplier' AND COLUMN_NAME = 'email') = 0,
  'ALTER TABLE `Supplier` ADD COLUMN `email` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

SET @sql = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Supplier' AND COLUMN_NAME = 'documentUrl') = 0,
  'ALTER TABLE `Supplier` ADD COLUMN `documentUrl` VARCHAR(191) NULL',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
